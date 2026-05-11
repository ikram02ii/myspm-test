import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';

/**
 * PHASE 7: Payment Security Middleware
 * 
 * Implements payment security validations:
 * - Prevents duplicate payment processing
 * - Validates payment amounts match plan prices
 * - Prevents replay attacks
 * - Validates ToyyibPay webhook signatures
 * - Rate limiting for payment attempts
 * - Transaction idempotency
 */

export class PaymentSecurityManager {
  private duplicatePaymentCache = new Map<string, number>();
  private attackedIPs = new Set<string>();
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly MAX_ATTEMPTS_PER_MINUTE = 5;
  private readonly DUPLICATE_CHECK_WINDOW = 3600000; // 1 hour

  constructor(private pool: Pool) {
    // Cleanup expired cache entries every 5 minutes
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
  }

  /**
   * Prevent duplicate payment processing within 1 hour window
   */
  preventDuplicatePayment = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { subscriptionId, amount, paymentType } = req.body;
      const clientIp = req.ip || 'unknown';
      const duplicateKey = `${subscriptionId}-${amount}-${paymentType}`;

      // Check if identical payment was just processed
      const lastPaymentTime = this.duplicatePaymentCache.get(duplicateKey);
      if (lastPaymentTime && Date.now() - lastPaymentTime < this.DUPLICATE_CHECK_WINDOW) {
        return res.status(409).json({
          error: 'Duplicate Payment',
          message: 'An identical payment was processed recently. Please try again later.',
          retryAfter: Math.ceil((this.DUPLICATE_CHECK_WINDOW - (Date.now() - lastPaymentTime)) / 1000)
        });
      }

      // Check database for duplicate within 1 hour
      const result = await this.pool.query(
        `SELECT id, created_at FROM payments 
         WHERE subscription_id = $1 AND amount = $2 AND status = 'pending'
         AND created_at > NOW() - INTERVAL '1 hour'
         LIMIT 1`,
        [subscriptionId, amount]
      );

      if (result.rowCount > 0) {
        return res.status(409).json({
          error: 'Duplicate Payment',
          message: 'A payment for this amount is already pending. Please check your transaction status.'
        });
      }

      // Store in cache
      this.duplicatePaymentCache.set(duplicateKey, Date.now());

      next();
    } catch (error) {
      res.status(500).json({ error: 'Duplicate payment check failed' });
    }
  };

  /**
   * Validate payment amount matches subscription plan
   */
  validatePaymentAmount = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { subscriptionId, amount } = req.body;

      // Get subscription and plan details
      const result = await this.pool.query(
        `SELECT ss.id, p.price, p.currency, ss.plan_id
         FROM student_subscriptions ss
         JOIN subscription_plans p ON ss.plan_id = p.id
         WHERE ss.id = $1`,
        [subscriptionId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const { price, currency } = result.rows[0];

      // Validate amount matches plan price (with 1% tolerance for currency conversion)
      const tolerance = price * 0.01;
      if (Math.abs(amount - price) > tolerance) {
        return res.status(400).json({
          error: 'Invalid Payment Amount',
          message: `Payment amount ${amount} does not match plan price ${price} ${currency}`,
          expectedAmount: price,
          currency
        });
      }

      req.body.validatedAmount = amount;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Amount validation failed' });
    }
  };

  /**
   * Rate limiting for payment attempts (prevent brute force)
   */
  rateLimit = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const clientIp = req.ip || 'unknown';
      const userId = req.user?.id || 'anonymous';
      const key = `payment:${userId}:${clientIp}`;

      // Check if IP is already attacked
      if (this.attackedIPs.has(clientIp)) {
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Too many payment attempts from this IP. Try again in a few minutes.'
        });
      }

      // Increment attempt counter
      const current = this.duplicatePaymentCache.get(key) || 0;
      const newCount = current + 1;

      if (newCount > this.MAX_ATTEMPTS_PER_MINUTE) {
        this.attackedIPs.add(clientIp);
        setTimeout(() => this.attackedIPs.delete(clientIp), 5 * 60 * 1000); // 5 min timeout

        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Too many payment attempts. Please try again in 5 minutes.'
        });
      }

      this.duplicatePaymentCache.set(key, newCount);
      setTimeout(() => this.duplicatePaymentCache.delete(key), this.RATE_LIMIT_WINDOW);

      next();
    } catch (error) {
      res.status(500).json({ error: 'Rate limit check failed' });
    }
  };

  /**
   * Validate ToyyibPay webhook signature
   */
  validateWebhookSignature = (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = req.headers['x-signature'] as string;
      const webhookSecret = process.env.TOYYIBPAY_WEBHOOK_SECRET;

      if (!signature || !webhookSecret) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }

      // Recreate signature from body
      const body = JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      // Constant-time comparison to prevent timing attacks
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Webhook signature validation failed' });
    }
  };

  /**
   * Prevent replay attacks with nonce validation
   */
  validateNonce = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const nonce = req.headers['x-nonce'] as string;

      if (!nonce) {
        return res.status(400).json({
          error: 'Missing Nonce',
          message: 'Request nonce is required'
        });
      }

      // Check if nonce already used (in last 5 minutes)
      const result = await this.pool.query(
        `SELECT id FROM nonce_cache WHERE nonce = $1 AND created_at > NOW() - INTERVAL '5 minutes'`,
        [nonce]
      );

      if (result.rowCount > 0) {
        return res.status(400).json({
          error: 'Nonce Already Used',
          message: 'This request has already been processed'
        });
      }

      // Store nonce
      await this.pool.query(
        `INSERT INTO nonce_cache (nonce, created_at) VALUES ($1, NOW())
         ON CONFLICT DO NOTHING`,
        [nonce]
      );

      next();
    } catch (error) {
      res.status(500).json({ error: 'Nonce validation failed' });
    }
  };

  /**
   * Validate subscription can accept payments
   */
  validateSubscriptionStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { subscriptionId } = req.body;

      const result = await this.pool.query(
        `SELECT id, status, expiry_date, plan_id
         FROM student_subscriptions
         WHERE id = $1`,
        [subscriptionId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const { status, expiry_date } = result.rows[0];

      // Cannot pay for subscription that is active and not expiring soon
      if (status === 'active' && new Date(expiry_date) > new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) {
        return res.status(400).json({
          error: 'Invalid Subscription Status',
          message: 'Your subscription is active and not yet due for renewal'
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Subscription status validation failed' });
    }
  };

  /**
   * Audit payment attempt for security logging
   */
  auditPaymentAttempt = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { subscriptionId, amount } = req.body;
      const clientIp = req.ip || 'unknown';
      const userId = req.user?.id;

      // Log attempt
      await this.pool.query(
        `INSERT INTO payment_audit_log (subscription_id, user_id, amount, status, client_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [subscriptionId, userId, amount, 'attempted', clientIp, req.get('user-agent')]
      );

      next();
    } catch (error) {
      res.status(500).json({ error: 'Audit logging failed' });
    }
  };

  /**
   * Cleanup expired cache entries
   */
  private cleanupCache() {
    const now = Date.now();
    for (const [key, timestamp] of this.duplicatePaymentCache.entries()) {
      if (now - timestamp > this.DUPLICATE_CHECK_WINDOW) {
        this.duplicatePaymentCache.delete(key);
      }
    }
  }
}
