/**
 * Background Jobs Module
 * 
 * Centralizes all background job initialization and management
 * Jobs include:
 * - Trial expiration (2 AM daily)
 * - Subscription expiration (3 AM daily)
 * - Package expiration cascading (3:30 AM daily)
 * - Auto-renewal processing (4 AM daily)
 * - Payment reminders (9 AM daily)
 */

import { Pool } from "pg";
import { initializeSubscriptionJobs } from "./subscriptionJobs";

/**
 * Start all background jobs
 * Call this once when the server starts
 */
export function startAllJobs(pool: Pool) {
  console.log("[JOBS] Initializing background jobs...");

  // Initialize subscription-related jobs
  initializeSubscriptionJobs(pool);

  console.log("[JOBS] All background jobs initialized successfully");
}

// Export job managers for direct access if needed
export { SubscriptionJobsManager, initializeSubscriptionJobs, getSubscriptionJobsManager } from "./subscriptionJobs";
