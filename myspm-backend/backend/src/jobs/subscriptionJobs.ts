import { Pool } from "pg";
import { v4 as uuid } from "uuid";
import cron from "node-cron";

/**
 * Background jobs for subscription management
 * - Trial expiration (daily at 2 AM)
 * - Subscription expiration (daily at 3 AM)
 * - Package expiration cascading (daily at 3:30 AM)
 * - Auto-renewal payment (daily at 4 AM)
 * - Payment reminders (daily at 9 AM)
 */

export class SubscriptionJobsManager {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Start all background jobs
   */
  startJobs() {
    // Trial expiration check - 2 AM daily
    cron.schedule("0 2 * * *", async () => {
      console.log("[CRON] Starting trial expiration job...");
      await this.expireTrialSubscriptions();
    });

    // Subscription expiration check - 3 AM daily
    cron.schedule("0 3 * * *", async () => {
      console.log("[CRON] Starting subscription expiration job...");
      await this.expireSubscriptions();
    });

    // Package expiration cascading - 3:30 AM daily
    cron.schedule("30 3 * * *", async () => {
      console.log("[CRON] Starting package expiration cascading job...");
      await this.cascadePackageExpiration();
    });

    // Auto-renewal payment - 4 AM daily
    cron.schedule("0 4 * * *", async () => {
      console.log("[CRON] Starting auto-renewal payment job...");
      await this.processAutoRenewal();
    });

    // Payment reminders - 9 AM daily
    cron.schedule("0 9 * * *", async () => {
      console.log("[CRON] Starting payment reminder job...");
      await this.sendPaymentReminders();
    });

    console.log("[JOBS] All subscription background jobs scheduled");
  }

  /**
   * Expire trial subscriptions that have reached their end date
   * Trial subscriptions expire after 14 days
   */
  async expireTrialSubscriptions() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Find expired trial subscriptions
      const result = await client.query(
        `SELECT id, user_id, plan_id FROM subscriptions
         WHERE status = 'trial' AND expiry_date <= NOW()`,
      );

      const expiredTrials = result.rows;
      console.log(`[CRON] Found ${expiredTrials.length} expired trial subscriptions`);

      // Update expired trials to 'expired' status
      for (const trial of expiredTrials) {
        await client.query(
          `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
           WHERE id = $1`,
          [trial.id],
        );

        // Log the expiration event
        await client.query(
          `INSERT INTO subscription_events
           (id, subscription_id, event_type, details, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [uuid(), trial.id, "trial_expired", "Trial subscription automatically expired"],
        );

        console.log(`[CRON] Trial subscription ${trial.id} expired`);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[CRON ERROR] expireTrialSubscriptions:", err);
    } finally {
      client.release();
    }
  }

  /**
   * Expire active/free subscriptions that have reached their end date
   * Downgrade to 'free' plan instead of marking as expired
   */
  async expireSubscriptions() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Find expired active subscriptions (not trial, not already expired)
      const result = await client.query(
        `SELECT s.id, s.user_id, s.plan_id, s.subscription_type
         FROM subscriptions s
         WHERE s.status IN ('active', 'free')
         AND s.expiry_date <= NOW()
         AND s.subscription_type != 'sponsored'`,
      );

      const expiredSubs = result.rows;
      console.log(`[CRON] Found ${expiredSubs.length} expired paid subscriptions`);

      // Get the free plan ID
      const freePlanResult = await client.query(
        `SELECT id FROM plans WHERE name = 'Free' LIMIT 1`,
      );
      const freePlanId = freePlanResult.rows[0]?.id;

      if (!freePlanId) {
        console.error("[CRON ERROR] Free plan not found");
        await client.query("ROLLBACK");
        return;
      }

      // Downgrade each expired subscription to free
      for (const sub of expiredSubs) {
        const newSubId = uuid();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Create new free subscription starting tomorrow
        await client.query(
          `INSERT INTO subscriptions
           (id, user_id, plan_id, status, subscription_type, start_date, 
            expiry_date, auto_renew, billing_cycle, amount_paid, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, NOW(), NOW())`,
          [
            newSubId,
            sub.user_id,
            freePlanId,
            "free",
            "self_service",
            tomorrow,
            new Date(tomorrow.getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year free
            false,
            "monthly",
            0,
          ],
        );

        // Mark old subscription as expired
        await client.query(
          `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
           WHERE id = $1`,
          [sub.id],
        );

        // Log the event
        await client.query(
          `INSERT INTO subscription_events
           (id, subscription_id, event_type, details, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [
            uuid(),
            sub.id,
            "subscription_expired",
            `Subscription expired and downgraded to Free plan`,
          ],
        );

        console.log(`[CRON] Subscription ${sub.id} expired and downgraded to free`);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[CRON ERROR] expireSubscriptions:", err);
    } finally {
      client.release();
    }
  }

  /**
   * When teacher packages expire, cascade the expiration to all assigned students
   * Updates student subscriptions to 'expired' status
   */
  async cascadePackageExpiration() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Find expired teacher packages
      const packagesResult = await client.query(
        `SELECT id FROM teacher_packages WHERE status = 'active' AND expiry_date <= NOW()`,
      );

      const expiredPackages = packagesResult.rows;
      console.log(`[CRON] Found ${expiredPackages.length} expired teacher packages`);

      for (const pkg of expiredPackages) {
        // Update package status
        await client.query(
          `UPDATE teacher_packages SET status = 'expired', updated_at = NOW()
           WHERE id = $1`,
          [pkg.id],
        );

        // Find all active sponsored subscriptions for this package
        const subsResult = await client.query(
          `SELECT DISTINCT s.id FROM subscriptions s
           INNER JOIN teacher_student_assignments tsa ON s.user_id = tsa.student_id
           WHERE tsa.teacher_package_id = $1
           AND s.status IN ('active', 'trial')
           AND s.subscription_type = 'sponsored'`,
          [pkg.id],
        );

        const sponsoredSubs = subsResult.rows;
        console.log(
          `[CRON] Found ${sponsoredSubs.length} sponsored subscriptions for package ${pkg.id}`,
        );

        // Expire each sponsored subscription
        for (const sub of sponsoredSubs) {
          await client.query(
            `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
             WHERE id = $1`,
            [sub.id],
          );

          await client.query(
            `INSERT INTO subscription_events
             (id, subscription_id, event_type, details, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [
              uuid(),
              sub.id,
              "sponsored_package_expired",
              "Teacher sponsorship package expired",
            ],
          );
        }

        console.log(`[CRON] Package ${pkg.id} expired and cascaded to ${sponsoredSubs.length} students`);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[CRON ERROR] cascadePackageExpiration:", err);
    } finally {
      client.release();
    }
  }

  /**
   * Process auto-renewal for subscriptions due to renew today
   * Creates payment request and charges the user
   */
  async processAutoRenewal() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Find subscriptions that:
      // 1. Have auto_renew = true
      // 2. Expiry date is today
      // 3. Status is 'active'
      // 4. Not sponsored (sponsored don't auto-renew)
      const result = await client.query(
        `SELECT s.id, s.user_id, s.plan_id, p.unit_price, p.name as plan_name
         FROM subscriptions s
         INNER JOIN plans p ON s.plan_id = p.id
         WHERE s.auto_renew = true
         AND DATE(s.expiry_date) = DATE(NOW())
         AND s.status = 'active'
         AND s.subscription_type != 'sponsored'`,
      );

      const dueDue = result.rows;
      console.log(`[CRON] Found ${dueDue.length} subscriptions due for auto-renewal`);

      // Process each auto-renewal
      for (const sub of dueDue) {
        const paymentId = uuid();
        const invoiceId = uuid();
        const newExpiry = new Date();
        newExpiry.setMonth(newExpiry.getMonth() + 1); // Renew for 1 month

        // Create invoice for the renewal
        await client.query(
          `INSERT INTO invoices
           (id, subscription_id, plan_id, amount, status, issue_date, due_date, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW())`,
          [invoiceId, sub.id, sub.plan_id, sub.unit_price, "pending", newExpiry],
        );

        // Create payment record (marked as pending)
        await client.query(
          `INSERT INTO payments
           (id, subscription_id, invoice_id, amount, status, payment_type, 
            bill_code, callback_reference, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            paymentId,
            sub.id,
            invoiceId,
            sub.unit_price,
            "pending",
            "auto_renewal",
            `AUTO-${uuid()}`,
            `AUTO-${uuid()}`,
          ],
        );

        // Log the event
        await client.query(
          `INSERT INTO subscription_events
           (id, subscription_id, event_type, details, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [
            uuid(),
            sub.id,
            "auto_renewal_initiated",
            `Auto-renewal payment initiated for ${sub.plan_name}`,
          ],
        );

        console.log(`[CRON] Auto-renewal initiated for subscription ${sub.id}`);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[CRON ERROR] processAutoRenewal:", err);
    } finally {
      client.release();
    }
  }

  /**
   * Send payment reminder emails to users 7 days before subscription expiry
   * Only send if not already sent today
   */
  async sendPaymentReminders() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Find subscriptions expiring in 7 days
      const result = await client.query(
        `SELECT DISTINCT s.id, s.user_id, u.email, u.name, p.name as plan_name,
                s.expiry_date, s.auto_renew
         FROM subscriptions s
         INNER JOIN users u ON s.user_id = u.id
         INNER JOIN plans p ON s.plan_id = p.id
         WHERE s.status = 'active'
         AND DATE(s.expiry_date) = DATE(NOW() + INTERVAL '7 days')
         AND s.subscription_type != 'sponsored'
         AND NOT EXISTS (
           SELECT 1 FROM subscription_events
           WHERE subscription_id = s.id
           AND event_type = 'payment_reminder_sent'
           AND DATE(created_at) = DATE(NOW())
         )`,
      );

      const dueForReminder = result.rows;
      console.log(`[CRON] Found ${dueForReminder.length} subscriptions due for payment reminders`);

      // Send email for each subscription (in production, use actual email service)
      for (const sub of dueForReminder) {
        // TODO: Send actual email using your email service
        // This is a placeholder - implement with nodemailer or other service
        console.log(
          `[CRON] Would send payment reminder to ${sub.email} for ${sub.plan_name} expiring on ${sub.expiry_date}`,
        );

        // Log that reminder was sent
        await client.query(
          `INSERT INTO subscription_events
           (id, subscription_id, event_type, details, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [
            uuid(),
            sub.id,
            "payment_reminder_sent",
            `Payment reminder sent to ${sub.email}. Subscription expires on ${new Date(sub.expiry_date).toLocaleDateString()}`,
          ],
        );

        console.log(`[CRON] Payment reminder logged for subscription ${sub.id}`);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[CRON ERROR] sendPaymentReminders:", err);
    } finally {
      client.release();
    }
  }
}

/**
 * Initialize and export job manager singleton
 */
let jobsManager: SubscriptionJobsManager | null = null;

export function initializeSubscriptionJobs(pool: Pool): SubscriptionJobsManager {
  if (!jobsManager) {
    jobsManager = new SubscriptionJobsManager(pool);
    jobsManager.startJobs();
  }
  return jobsManager;
}

export function getSubscriptionJobsManager(): SubscriptionJobsManager | null {
  return jobsManager;
}
