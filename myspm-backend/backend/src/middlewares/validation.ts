import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

/**
 * PHASE 7: Data Validation Middleware
 * 
 * Uses Zod schemas for runtime validation of:
 * - Request body structure and types
 * - Input sanitization
 * - Business logic constraints
 * - Error reporting with field-level details
 */

// Subscription payment validation schema
export const paymentSchema = z.object({
  subscriptionId: z.string().uuid('Invalid subscription ID format'),
  amount: z.number().positive('Amount must be positive').max(99999, 'Amount exceeds maximum'),
  planId: z.string().uuid('Invalid plan ID format').optional(),
  paymentType: z.enum(['manual', 'auto_renewal']),
  description: z.string().max(500).optional(),
  nonce: z.string().min(32).max(64).optional()
});

// Student subscription update schema
export const subscriptionUpdateSchema = z.object({
  planId: z.string().uuid('Invalid plan ID format'),
  autoRenewal: z.boolean().default(true),
  paymentMethod: z.enum(['credit_card', 'debit_card', 'online_banking']).optional()
});

// Teacher package creation schema
export const teacherPackageSchema = z.object({
  packageName: z.string().min(1).max(100).trim(),
  studentCount: z.number().int().positive().min(1).max(500),
  durationMonths: z.number().int().positive().min(1).max(36),
  notes: z.string().max(1000).optional()
});

// Teacher package assignment schema
export const packageAssignmentSchema = z.object({
  packageId: z.string().uuid('Invalid package ID format'),
  studentIds: z.array(z.string().uuid('Invalid student ID format')).min(1).max(500)
});

// Admin plan management schema
export const planManagementSchema = z.object({
  name: z.string().min(3).max(50).trim(),
  description: z.string().max(500).optional(),
  price: z.number().positive('Price must be positive').max(99999),
  currency: z.enum(['MYR', 'USD', 'SGD']).default('MYR'),
  durationMonths: z.number().int().positive(),
  features: z.array(z.string()).min(1),
  maxStudents: z.number().int().positive().optional(),
  isActive: z.boolean().default(true)
});

// Login schema
export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6).max(100)
});

/**
 * Generic validation middleware factory
 * Usage: router.post('/endpoint', validate(schemaName), handler)
 */
export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code
          }))
        });
      }

      res.status(500).json({ error: 'Validation failed' });
    }
  };
};

/**
 * Sanitize string inputs (prevent XSS)
 */
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  const sanitize = (obj: any): any => {
    if (typeof obj === 'string') {
      // Remove HTML tags and special characters
      return obj
        .replace(/<[^>]*>/g, '')
        .replace(/[<>]/g, '')
        .trim();
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }

    if (typeof obj === 'object' && obj !== null) {
      return Object.keys(obj).reduce((acc, key) => {
        acc[key] = sanitize(obj[key]);
        return acc;
      }, {} as any);
    }

    return obj;
  };

  req.body = sanitize(req.body);
  next();
};

/**
 * Validate email format
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

/**
 * Validate UUID format
 */
export const validateUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Validate currency amount
 */
export const validateAmount = (amount: number): boolean => {
  return typeof amount === 'number' && amount > 0 && amount <= 999999.99;
};

/**
 * Validate subscription plan configuration
 */
export const validatePlanConfig = (
  price: number,
  durationMonths: number,
  maxStudents?: number
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (price <= 0 || price > 999999.99) {
    errors.push('Price must be between 0 and 999999.99');
  }

  if (durationMonths < 1 || durationMonths > 36) {
    errors.push('Duration must be between 1 and 36 months');
  }

  if (maxStudents && (maxStudents < 1 || maxStudents > 1000)) {
    errors.push('Max students must be between 1 and 1000');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate payment metadata
 */
export const validatePaymentMetadata = (metadata: any): boolean => {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }

  const requiredFields = ['subscriptionId', 'userId', 'amount'];
  return requiredFields.every(field => field in metadata);
};

/**
 * Detect potential SQL injection attempts
 */
export const detectSQLInjection = (input: string): boolean => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /(-{2})|({)(;)/,
    /(;|\|\|)/
  ];

  return sqlPatterns.some(pattern => pattern.test(input));
};

/**
 * Validate request structure for list endpoints
 */
export const listQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).refine(n => n > 0).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).refine(n => n > 0 && n <= 100).default('20'),
  sort: z.string().regex(/^[a-zA-Z_]+$/).optional(),
  order: z.enum(['asc', 'desc']).default('desc')
});

export const validateListQuery = (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = listQuerySchema.parse(req.query);
    req.query = validated as any;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid Query Parameters',
        details: error.errors
      });
    }

    res.status(500).json({ error: 'Query validation failed' });
  }
};
