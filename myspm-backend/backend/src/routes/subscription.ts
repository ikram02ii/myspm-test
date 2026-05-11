import express, { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  SubscriptionAuthManager,
  PaymentSecurityManager
} from '../middlewares';
import {
  validate,
  sanitizeInput,
  paymentSchema,
  subscriptionUpdateSchema,
  planManagementSchema,
  validateListQuery
} from '../middlewares';

/**
 * PHASE 7: Protected Subscription Routes
 * 
 * All routes include comprehensive security:
 * - Role-based authorization
 * - Input validation and sanitization
 * - Payment security checks
 * - Duplicate prevention
 * - Audit logging
 * - Transaction safety
 */

export const createSubscriptionRouter = (pool: Pool): Router => {
  const router = express.Router();
  const authManager = new SubscriptionAuthManager(pool);
  const securityManager = new PaymentSecurityManager(pool);

  // ============================================================
  // Student Subscription Routes (require student role)
  // ============================================================

  /**
   * GET /api/subscriptions/student/:studentId
   * Get student's subscription details
   * Authorization: Student (own) or Teacher/Admin (any)
   */
  router.get(
    '/student/:studentId',
    authManager.authorizeStudentSubscription,
    async (req: Request, res: Response) => {
      try {
        const { studentId } = req.params;

        const result = await pool.query(
          `SELECT 
            ss.id,
            ss.student_id,
            ss.plan_id,
            sp.name as plan_name,
            sp.price,
            sp.currency,
            ss.status,
            ss.expiry_date,
            ss.auto_renewal,
            ss.created_at,
            CASE 
              WHEN ss.expiry_date > NOW() THEN CEIL(EXTRACT(DAY FROM ss.expiry_date - NOW()))
              ELSE 0
            END as days_remaining
          FROM student_subscriptions ss
          JOIN subscription_plans sp ON ss.plan_id = sp.id
          WHERE ss.student_id = $1
          ORDER BY ss.created_at DESC
          LIMIT 1`,
          [studentId]
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Subscription not found' });
        }

        res.json(result.rows[0]);
      } catch (error) {
        console.error('Error fetching subscription:', error);
        res.status(500).json({ error: 'Failed to fetch subscription' });
      }
    }
  );

  /**
   * POST /api/subscriptions/student/:studentId/upgrade
   * Upgrade/change student subscription
   * Authorization: Student (own) or Admin
   */
  router.post(
    '/student/:studentId/upgrade',
    authManager.authorizeStudentSubscription,
    sanitizeInput,
    validate(subscriptionUpdateSchema),
    async (req: Request, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { studentId } = req.params;
        const { planId, autoRenewal } = req.body;

        // Verify new plan exists
        const planResult = await client.query(
          `SELECT id, price FROM subscription_plans WHERE id = $1 AND is_active = true`,
          [planId]
        );

        if (planResult.rowCount === 0) {
          return res.status(404).json({ error: 'Plan not found or inactive' });
        }

        const newPrice = planResult.rows[0].price;

        // Get current subscription
        const currentResult = await client.query(
          `SELECT id, plan_id, status, expiry_date 
           FROM student_subscriptions 
           WHERE student_id = $1 
           ORDER BY created_at DESC 
           LIMIT 1`,
          [studentId]
        );

        if (currentResult.rowCount === 0) {
          return res.status(404).json({ error: 'Current subscription not found' });
        }

        const currentSub = currentResult.rows[0];
        const subscriptionId = uuidv4();

        // Create new subscription
        await client.query(
          `INSERT INTO student_subscriptions 
           (id, student_id, plan_id, status, expiry_date, auto_renewal, created_at)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 month', $5, NOW())`,
          [subscriptionId, studentId, planId, 'active', autoRenewal]
        );

        // Log event
        await client.query(
          `INSERT INTO subscription_events 
           (id, subscription_id, event_type, description, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [uuidv4(), subscriptionId, 'upgraded', `Upgraded from plan ${currentSub.plan_id} to ${planId}`]
        );

        await client.query('COMMIT');

        res.status(201).json({
          message: 'Subscription upgraded successfully',
          subscriptionId,
          newPrice
        });
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error upgrading subscription:', error);
        res.status(500).json({ error: 'Failed to upgrade subscription' });
      } finally {
        client.release();
      }
    }
  );

  // ============================================================
  // Payment Routes (secure payment processing)
  // ============================================================

  /**
   * POST /api/subscriptions/payment/initiate
   * Initiate payment for subscription
   * Security: All validations + duplicate prevention + rate limiting
   */
  router.post(
    '/payment/initiate',
    sanitizeInput,
    validate(paymentSchema),
    securityManager.rateLimit,
    securityManager.preventDuplicatePayment,
    securityManager.validatePaymentAmount,
    securityManager.validateSubscriptionStatus,
    securityManager.auditPaymentAttempt,
    async (req: Request, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { subscriptionId, amount, paymentType, description } = req.body;
        const paymentId = uuidv4();
        const invoiceId = uuidv4();

        // Create invoice
        await client.query(
          `INSERT INTO invoices 
           (id, subscription_id, amount, status, due_date, created_at, description)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days', NOW(), $5)`,
          [invoiceId, subscriptionId, amount, 'pending', description]
        );

        // Create payment record
        await client.query(
          `INSERT INTO payments 
           (id, subscription_id, invoice_id, amount, status, payment_type, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [paymentId, subscriptionId, invoiceId, amount, 'pending', paymentType]
        );

        // Log event
        await client.query(
          `INSERT INTO subscription_events 
           (id, subscription_id, event_type, description, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [uuidv4(), subscriptionId, 'payment_initiated', `Payment initiated for amount ${amount}`]
        );

        await client.query('COMMIT');

        res.status(201).json({
          message: 'Payment initiated successfully',
          paymentId,
          invoiceId,
          redirectUrl: `${process.env.PAYMENT_GATEWAY_URL}?invoiceId=${invoiceId}`,
          amount
        });
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error initiating payment:', error);
        res.status(500).json({ error: 'Failed to initiate payment' });
      } finally {
        client.release();
      }
    }
  );

  /**
   * POST /api/subscriptions/payment/webhook
   * ToyyibPay webhook callback (signature validated)
   * Security: Webhook signature validation + nonce checking
   */
  router.post(
    '/payment/webhook',
    securityManager.validateWebhookSignature,
    securityManager.validateNonce,
    async (req: Request, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { invoiceId, status, transactionRef, paidAmount } = req.body;

        // Update payment status
        await client.query(
          `UPDATE payments 
           SET status = $1, transaction_ref = $2, updated_at = NOW()
           WHERE invoice_id = $3`,
          [status === 'success' ? 'completed' : 'failed', transactionRef, invoiceId]
        );

        // Update subscription if payment successful
        if (status === 'success') {
          await client.query(
            `UPDATE student_subscriptions 
             SET status = 'active', expiry_date = NOW() + INTERVAL '1 month'
             WHERE id = (SELECT subscription_id FROM invoices WHERE id = $1)`,
            [invoiceId]
          );
        }

        await client.query('COMMIT');

        res.json({ message: 'Webhook processed successfully' });
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
      } finally {
        client.release();
      }
    }
  );

  // ============================================================
  // Admin Plan Management Routes
  // ============================================================

  /**
   * POST /api/subscriptions/plans
   * Create new subscription plan
   * Authorization: Admin only
   */
  router.post(
    '/plans',
    authManager.authorizeAdmin,
    sanitizeInput,
    validate(planManagementSchema),
    async (req: Request, res: Response) => {
      try {
        const { name, description, price, currency, durationMonths, features, isActive } = req.body;
        const planId = uuidv4();

        await pool.query(
          `INSERT INTO subscription_plans 
           (id, name, description, price, currency, duration_months, features, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [planId, name, description, price, currency, durationMonths, JSON.stringify(features), isActive]
        );

        res.status(201).json({
          message: 'Plan created successfully',
          planId,
          name,
          price
        });
      } catch (error) {
        console.error('Error creating plan:', error);
        res.status(500).json({ error: 'Failed to create plan' });
      }
    }
  );

  /**
   * GET /api/subscriptions/plans
   * List subscription plans (paginated)
   */
  router.get(
    '/plans',
    validateListQuery,
    async (req: Request, res: Response) => {
      try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const offset = (page - 1) * limit;

        const result = await pool.query(
          `SELECT id, name, description, price, currency, duration_months, is_active, created_at
           FROM subscription_plans
           WHERE is_active = true
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );

        const countResult = await pool.query(
          `SELECT COUNT(*) as total FROM subscription_plans WHERE is_active = true`
        );

        res.json({
          plans: result.rows,
          pagination: {
            page,
            limit,
            total: parseInt(countResult.rows[0].total)
          }
        });
      } catch (error) {
        console.error('Error fetching plans:', error);
        res.status(500).json({ error: 'Failed to fetch plans' });
      }
    }
  );

  return router;
};
