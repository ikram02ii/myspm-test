/**
 * PHASE 7: Middleware Exports
 * 
 * Centralized middleware module for authentication, authorization, validation,
 * and payment security. Each middleware is designed to be composable and applied
 * selectively to different routes.
 */

export { SubscriptionAuthManager } from './subscriptionAuth';
export { PaymentSecurityManager } from './paymentSecurity';
export {
  validate,
  sanitizeInput,
  validateEmail,
  validateUUID,
  validateAmount,
  validatePlanConfig,
  validatePaymentMetadata,
  detectSQLInjection,
  validateListQuery,
  paymentSchema,
  subscriptionUpdateSchema,
  teacherPackageSchema,
  packageAssignmentSchema,
  planManagementSchema,
  loginSchema,
  listQuerySchema
} from './validation';
