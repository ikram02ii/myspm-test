/**
 * Payment Routes - ToyyibPay Integration
 * 
 * Implements subscription and teacher package payment processing via ToyyibPay
 * 
 * Endpoints:
 * - POST /payment/create      - Create payment request and redirect to ToyyibPay
 * - POST /payment/callback    - Webhook for payment status updates
 * - GET  /payment/status      - Check payment status
 */

import { Router, Request, Response, NextFunction } from 'express';
import { uuid } from 'uuidv4';
import { pool } from '../db';
import { authMiddleware, authorize } from '../middleware/auth';
import axios, { AxiosError } from 'axios';
import crypto from 'crypto';

const router = Router();

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface CreatePaymentRequest {
  plan_id: string;
  billing_cycle: 'monthly' | 'yearly';
  type: 'subscription' | 'teacher_package'; // subscription or teacher_package
  teacher_package_seats?: number; // Required if type === 'teacher_package'
}

interface ToyyibPayCreateResponse {
  status: number; // 0 = success
  message: string;
  data: {
    billCode: string;
    billExpiryDate: string;
    billURL: string;
    billName: string;
    reference_number: string;
  };
}

interface ToyyibPayCallbackData {
  billCode: string;
  status: string; // '1' = paid, '0' = unpaid, '-1' = failed
  amount: string;
  paidDate: string;
  referenceNo: string;
  callbackReference: string;
  billName: string;
  [key: string]: any;
}

interface ToyyibPayVerifyResponse {
  status: number; // 0 = success
  message: string;
  data: {
    billCode: string;
    billName: string;
    billDescription: string;
    billPriceSetting: number;
    billPayorInfo: number;
    billEmail: string;
    billPhone: string;
    billSplitPayment: number;
    billPaymentChannel: string;
    billContentEmail: string;
    billExpiryDate: string;
    billExpiryTime: string;
    billRefrenceNo: string; // Note: ToyyibPay typo in their API
    billPaymentId: string;
    billpaymentStatus: string;
    billpaymentDate: string;
    billpaymentPaidDate: string;
    billName2: string;
    billDescription2: string;
    billAmount: string;
    billPaymentAmount: string;
    billDiscount: number;
    [key: string]: any;
  };
}

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const TOYYIBPAY_API_BASE = 'https://toyyibpay.com/api/v2';
const TOYYIBPAY_SECRET = process.env.TOYYIBPAY_SECRET || '';
const TOYYIBPAY_CATEGORY = process.env.TOYYIBPAY_CATEGORY || '';
const APP_URL = process.env.APP_URL || 'https://app.myspm.com';
const API_URL = process.env.API_URL || 'https://api.myspm.com';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get payment details for idempotency check
 */
async function getExistingPayment(callbackReference: string) {
  const result = await pool.query(
    'SELECT * FROM payments WHERE callback_reference = $1 AND deleted_at IS NULL',
    [callbackReference]
  );
  return result.rows[0] || null;
}

/**
 * Log payment event
 */
async function logPaymentEvent(
  paymentId: string,
  eventType: string,
  status: string | null,
  requestData: any = null,
  responseData: any = null,
  callbackData: any = null,
  errorMessage: string | null = null,
  errorCode: string | null = null,
  userId: string | null = null
) {
  await pool.query(
    `INSERT INTO payment_logs 
    (payment_id, event_type, status, request_data, response_data, callback_data, 
     error_message, error_code, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      paymentId,
      eventType,
      status,
      JSON.stringify(requestData),
      JSON.stringify(responseData),
      JSON.stringify(callbackData),
      errorMessage,
      errorCode,
      userId,
    ]
  );
}

/**
 * Create payment request with ToyyibPay
 */
async function createToyyibPayRequest(
  paymentData: any,
  user: any
): Promise<ToyyibPayCreateResponse> {
  const requestPayload = {
    userSecretKey: TOYYIBPAY_SECRET,
    categoryCode: TOYYIBPAY_CATEGORY,
    billName: paymentData.description,
    billDescription: paymentData.description,
    billPriceSetting: parseFloat(paymentData.amount),
    billPayorInfo: 1,
    billEmail: user.email,
    billPhoneNumber: user.phone || '',
    billExpiryDate: new Date(Date.now() + 3600000).toISOString().slice(0, 16), // 1 hour from now
    billContentEmail: user.email,
    referenceNo: paymentData.id,
    returnUrl: `${APP_URL}/payment/success`,
    callbackUrl: `${API_URL}/payment/callback`,
  };

  try {
    const response = await axios.post(
      `${TOYYIBPAY_API_BASE}/bills`,
      requestPayload
    );

    return response.data as ToyyibPayCreateResponse;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('ToyyibPay API Error:', axiosError.message);
    throw new Error(
      `Failed to create payment with ToyyibPay: ${axiosError.message}`
    );
  }
}

/**
 * Verify payment with ToyyibPay API
 */
async function verifyPaymentWithToyyibPay(
  billCode: string
): Promise<ToyyibPayVerifyResponse> {
  try {
    const response = await axios.get(`${TOYYIBPAY_API_BASE}/bills/${billCode}`, {
      params: {
        userSecretKey: TOYYIBPAY_SECRET,
        includeDetails: 1,
      },
    });

    return response.data as ToyyibPayVerifyResponse;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('ToyyibPay Verification Error:', axiosError.message);
    throw new Error(
      `Failed to verify payment with ToyyibPay: ${axiosError.message}`
    );
  }
}

/**
 * Calculate subscription expiry date
 */
function calculateExpiryDate(
  billingCycle: 'monthly' | 'yearly'
): Date {
  const date = new Date();
  if (billingCycle === 'monthly') {
    date.setMonth(date.getMonth() + 1);
  } else {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date;
}

/**
 * Create subscription after payment verification
 */
async function createSubscription(
  userId: string,
  planId: string,
  paymentId: string,
  billingCycle: 'monthly' | 'yearly'
) {
  const subscriptionId = uuid();
  const expiryDate = calculateExpiryDate(billingCycle);

  await pool.query(
    `INSERT INTO subscriptions
    (id, user_id, plan_id, status, billing_cycle, activated_at, expiry_date, 
     auto_renew, payment_id, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      subscriptionId,
      userId,
      planId,
      'active',
      billingCycle,
      new Date(),
      expiryDate,
      true,
      paymentId,
      userId,
    ]
  );

  // Log event
  await pool.query(
    `INSERT INTO subscription_events
    (subscription_id, user_id, event_type, new_status, event_data, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      subscriptionId,
      userId,
      'subscription_activated',
      'active',
      JSON.stringify({
        billing_cycle: billingCycle,
        plan_id: planId,
        activated_via: 'payment',
      }),
      'system',
    ]
  );

  return subscriptionId;
}

/**
 * Create teacher package after payment verification
 */
async function createTeacherPackage(
  teacherId: string,
  planId: string,
  paymentId: string,
  billingCycle: 'monthly' | 'yearly',
  totalSeats: number,
  amount: number
) {
  const packageId = uuid();
  const expiryDate = calculateExpiryDate(billingCycle);

  await pool.query(
    `INSERT INTO teacher_packages
    (id, teacher_id, plan_id, billing_cycle, total_seats, assigned_seats,
     purchase_date, expiry_date, status, payment_id, amount_paid, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      packageId,
      teacherId,
      planId,
      billingCycle,
      totalSeats,
      0, // No students assigned yet
      new Date(),
      expiryDate,
      'active',
      paymentId,
      amount,
      teacherId,
    ]
  );

  return packageId;
}

/**
 * Create invoice after successful payment
 */
async function createInvoice(
  userId: string,
  paymentId: string,
  subscriptionId: string | null,
  teacherPackageId: string | null,
  amount: number,
  description: string
) {
  const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const invoiceId = uuid();

  await pool.query(
    `INSERT INTO invoices
    (id, user_id, payment_id, subscription_id, teacher_package_id,
     invoice_number, invoice_date, status, sub_total, tax_amount, total_amount,
     currency, description, sent_at, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      invoiceId,
      userId,
      paymentId,
      subscriptionId,
      teacherPackageId,
      invoiceNumber,
      new Date(),
      'issued',
      amount,
      0,
      amount,
      'MYR',
      description,
      new Date(),
      'system',
    ]
  );

  return { invoiceId, invoiceNumber };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /payment/create
 * Create payment request and redirect to ToyyibPay
 */
router.post(
  '/create',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user.id;
      const { plan_id, billing_cycle, type, teacher_package_seats } =
        req.body as CreatePaymentRequest;

      // ===== VALIDATION =====
      if (!plan_id || !billing_cycle || !type) {
        return res.status(400).json({
          error: 'Missing required fields: plan_id, billing_cycle, type',
        });
      }

      if (!['monthly', 'yearly'].includes(billing_cycle)) {
        return res.status(400).json({
          error: 'Invalid billing_cycle. Must be monthly or yearly',
        });
      }

      if (!['subscription', 'teacher_package'].includes(type)) {
        return res.status(400).json({
          error: 'Invalid type. Must be subscription or teacher_package',
        });
      }

      if (type === 'teacher_package' && !teacher_package_seats) {
        return res.status(400).json({
          error: 'teacher_package_seats required for teacher_package type',
        });
      }

      // ===== GET PLAN & USER DATA =====
      const planResult = await pool.query(
        'SELECT * FROM plans WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
        [plan_id]
      );

      if (planResult.rows.length === 0) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const plan = planResult.rows[0];

      const userResult = await pool.query(
        'SELECT id, email, phone FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];

      // ===== CALCULATE AMOUNT =====
      let amount = 0;
      let description = '';

      if (type === 'subscription') {
        amount =
          billing_cycle === 'monthly'
            ? plan.monthly_price
            : plan.yearly_price * (1 - plan.discount_yearly_percent / 100);
        description = `${plan.name} - ${billing_cycle}`;
      } else {
        // teacher_package
        const seatPrice =
          billing_cycle === 'monthly'
            ? plan.monthly_price
            : plan.yearly_price * (1 - plan.discount_yearly_percent / 100);
        amount = seatPrice * teacher_package_seats;
        description = `${plan.name} - ${teacher_package_seats} seats - ${billing_cycle}`;
      }

      if (amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount calculated' });
      }

      // ===== CREATE PAYMENT RECORD =====
      const paymentId = uuid();

      await pool.query(
        `INSERT INTO payments
        (id, user_id, plan_id, amount, currency, status, payment_provider,
         billing_cycle, description, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          paymentId,
          userId,
          plan_id,
          amount,
          'MYR',
          'pending',
          'toyyibpay',
          billing_cycle,
          description,
          userId,
        ]
      );

      // Log creation
      await logPaymentEvent(
        paymentId,
        'payment_created',
        'pending',
        {
          plan_id,
          amount,
          billing_cycle,
          type,
          teacher_package_seats,
        },
        null,
        null,
        null,
        null,
        userId
      );

      // ===== CREATE TOYYIBPAY REQUEST =====
      let toyyibPayResponse: ToyyibPayCreateResponse;

      try {
        toyyibPayResponse = await createToyyibPayRequest(
          {
            id: paymentId,
            amount: amount.toString(),
            description,
          },
          user
        );
      } catch (error) {
        // Mark payment as failed
        await pool.query(
          'UPDATE payments SET status = $1, failed_at = $2 WHERE id = $3',
          ['failed', new Date(), paymentId]
        );

        await logPaymentEvent(
          paymentId,
          'payment_creation_failed',
          'failed',
          null,
          null,
          null,
          (error as Error).message,
          'toyyibpay_api_error',
          userId
        );

        return res.status(500).json({
          error: 'Failed to create payment. Please try again.',
        });
      }

      if (toyyibPayResponse.status !== 0) {
        // ToyyibPay error
        await pool.query(
          'UPDATE payments SET status = $1, failed_at = $2 WHERE id = $3',
          ['failed', new Date(), paymentId]
        );

        await logPaymentEvent(
          paymentId,
          'payment_creation_failed',
          'failed',
          null,
          toyyibPayResponse,
          null,
          toyyibPayResponse.message,
          'toyyibpay_error',
          userId
        );

        return res.status(500).json({
          error: 'Failed to create payment with payment provider',
        });
      }

      // ===== UPDATE PAYMENT WITH GATEWAY REFERENCE =====
      const billCode = toyyibPayResponse.data.billCode;

      await pool.query(
        'UPDATE payments SET transaction_reference = $1, status = $2, updated_at = $3 WHERE id = $4',
        ['processing', billCode, new Date(), paymentId]
      );

      await logPaymentEvent(
        paymentId,
        'payment_submitted_to_gateway',
        'processing',
        null,
        toyyibPayResponse,
        null,
        null,
        null,
        userId
      );

      // ===== RETURN REDIRECT URL =====
      return res.json({
        success: true,
        payment_id: paymentId,
        bill_code: billCode,
        bill_url: toyyibPayResponse.data.billURL,
        expiry_date: toyyibPayResponse.data.billExpiryDate,
        message: 'Please complete payment on ToyyibPay platform',
      });
    } catch (error) {
      console.error('Payment creation error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * POST /payment/callback
 * Receive and process ToyyibPay webhook
 * 
 * SECURITY:
 * - Idempotency: Use callbackReference to prevent duplicate processing
 * - Verification: Always verify with ToyyibPay API (never trust client data)
 */
router.post(
  '/callback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const callbackData = req.body as ToyyibPayCallbackData;

      // ===== IDEMPOTENCY CHECK =====
      // callbackReference is unique per callback, prevents duplicates
      const callbackReference = callbackData.callbackReference;

      if (!callbackReference) {
        console.warn('Callback received without callbackReference');
        return res.status(400).json({ error: 'Missing callbackReference' });
      }

      // Check if already processed
      const existingPayment = await getExistingPayment(callbackReference);
      if (existingPayment && existingPayment.status === 'completed') {
        console.log(
          `Callback already processed for ${callbackReference}, returning 200`
        );
        return res.status(200).json({ success: true, message: 'Already processed' });
      }

      // ===== BASIC VALIDATION =====
      const billCode = callbackData.billCode;
      const referenceNo = callbackData.referenceNo;

      if (!billCode || !referenceNo) {
        console.warn('Callback missing billCode or referenceNo');
        return res.status(400).json({
          error: 'Missing billCode or referenceNo',
        });
      }

      // ===== GET PAYMENT FROM DB =====
      const paymentResult = await pool.query(
        'SELECT * FROM payments WHERE id = $1 AND deleted_at IS NULL',
        [referenceNo]
      );

      if (paymentResult.rows.length === 0) {
        console.warn(`Payment not found for referenceNo: ${referenceNo}`);
        return res.status(404).json({ error: 'Payment not found' });
      }

      const payment = paymentResult.rows[0];

      // ===== VERIFY WITH TOYYIBPAY API =====
      // CRITICAL: Never trust callback data, always verify with API
      let verifyResponse: ToyyibPayVerifyResponse;

      try {
        verifyResponse = await verifyPaymentWithToyyibPay(billCode);
      } catch (error) {
        console.error('Payment verification failed:', error);
        await logPaymentEvent(
          payment.id,
          'payment_verification_failed',
          'failed',
          callbackData,
          null,
          null,
          (error as Error).message,
          'verification_error'
        );
        return res.status(500).json({ error: 'Verification failed' });
      }

      if (verifyResponse.status !== 0) {
        console.error('ToyyibPay verification error:', verifyResponse.message);
        await logPaymentEvent(
          payment.id,
          'payment_verification_failed',
          'failed',
          null,
          verifyResponse,
          callbackData,
          verifyResponse.message,
          'toyyibpay_error'
        );
        return res.status(400).json({ error: 'Verification failed' });
      }

      // ===== CHECK PAYMENT STATUS =====
      const isPaid = verifyResponse.data.billpaymentStatus === '1';

      if (!isPaid) {
        console.log(`Payment not completed for ${billCode}`);
        await pool.query(
          'UPDATE payments SET status = $1, callback_data = $2, updated_at = $3 WHERE id = $4',
          [
            'failed',
            JSON.stringify(verifyResponse.data),
            new Date(),
            payment.id,
          ]
        );

        await logPaymentEvent(
          payment.id,
          'payment_status_unpaid',
          'failed',
          null,
          verifyResponse,
          callbackData
        );

        return res.status(200).json({
          success: true,
          message: 'Payment not completed',
        });
      }

      // ===== PAYMENT COMPLETED - UPDATE DATABASE =====
      await pool.query(
        `UPDATE payments 
        SET status = $1, callback_reference = $2, callback_data = $3, 
            completed_at = $4, updated_at = $5 
        WHERE id = $6`,
        [
          'completed',
          callbackReference,
          JSON.stringify(verifyResponse.data),
          new Date(),
          new Date(),
          payment.id,
        ]
      );

      await logPaymentEvent(
        payment.id,
        'payment_verified',
        'completed',
        null,
        verifyResponse,
        callbackData
      );

      // ===== CREATE SUBSCRIPTION OR TEACHER PACKAGE =====
      let subscriptionId = null;
      let teacherPackageId = null;

      try {
        if (!payment.subscription_id && !payment.teacher_package_id) {
          // Determine payment type
          if (payment.billing_cycle) {
            // This is a subscription payment (has billing_cycle)
            subscriptionId = await createSubscription(
              payment.user_id,
              payment.plan_id,
              payment.id,
              payment.billing_cycle
            );

            await pool.query(
              'UPDATE payments SET subscription_id = $1 WHERE id = $2',
              [subscriptionId, payment.id]
            );
          } else {
            // This is a teacher package payment
            // Get teacher_package_seats from somewhere (need to store in payment)
            // For now, calculate from amount / plan price
            const planResult = await pool.query(
              'SELECT * FROM plans WHERE id = $1',
              [payment.plan_id]
            );
            const plan = planResult.rows[0];
            const seatPrice = plan.monthly_price; // Simplified
            const totalSeats = Math.round(payment.amount / seatPrice);

            teacherPackageId = await createTeacherPackage(
              payment.user_id,
              payment.plan_id,
              payment.id,
              payment.billing_cycle || 'monthly',
              totalSeats,
              payment.amount
            );

            await pool.query(
              'UPDATE payments SET teacher_package_id = $1 WHERE id = $2',
              [teacherPackageId, payment.id]
            );
          }
        }

        // ===== CREATE INVOICE =====
        await createInvoice(
          payment.user_id,
          payment.id,
          subscriptionId,
          teacherPackageId,
          payment.amount,
          payment.description
        );

        // ===== SUCCESS RESPONSE =====
        return res.status(200).json({
          success: true,
          message: 'Payment processed successfully',
          payment_id: payment.id,
          subscription_id: subscriptionId,
          teacher_package_id: teacherPackageId,
        });
      } catch (error) {
        console.error('Error creating subscription/package:', error);
        await logPaymentEvent(
          payment.id,
          'subscription_creation_failed',
          'completed',
          null,
          null,
          null,
          (error as Error).message,
          'subscription_error'
        );

        // Payment was processed but subscription creation failed
        // This should be handled by admin/support
        return res.status(500).json({
          error: 'Payment processed but activation failed. Contact support.',
        });
      }
    } catch (error) {
      console.error('Callback processing error:', error);
      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

/**
 * GET /payment/status/:payment_id
 * Check payment status
 */
router.get(
  '/status/:payment_id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user.id;
      const { payment_id } = req.params;

      // Get payment
      const paymentResult = await pool.query(
        'SELECT * FROM payments WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [payment_id, userId]
      );

      if (paymentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      const payment = paymentResult.rows[0];

      // Get related subscription or package
      let relatedData = null;

      if (payment.subscription_id) {
        const subResult = await pool.query(
          'SELECT id, status, plan_id, expiry_date FROM subscriptions WHERE id = $1',
          [payment.subscription_id]
        );
        relatedData = subResult.rows[0] || null;
      }

      if (payment.teacher_package_id) {
        const pkgResult = await pool.query(
          'SELECT id, status, total_seats, assigned_seats, expiry_date FROM teacher_packages WHERE id = $1',
          [payment.teacher_package_id]
        );
        relatedData = pkgResult.rows[0] || null;
      }

      return res.json({
        success: true,
        payment: {
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          plan_id: payment.plan_id,
          billing_cycle: payment.billing_cycle,
          transaction_reference: payment.transaction_reference,
          created_at: payment.created_at,
          completed_at: payment.completed_at,
        },
        related: relatedData,
      });
    } catch (error) {
      console.error('Payment status error:', error);
      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

export default router;
