import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';

// Extend Express Request to include user and auth data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'student' | 'teacher' | 'admin' | 'superadmin';
      };
      teacherId?: string;
      studentId?: string;
    }
  }
}

/**
 * PHASE 7: Authorization Middleware
 * 
 * Provides role-based access control (RBAC) for subscription operations.
 * Enforces that:
 * - Students can only access/modify their own subscriptions
 * - Teachers can only manage packages they created
 * - Admins can manage all subscriptions/plans
 * - Superadmins have full access
 */

export class SubscriptionAuthManager {
  constructor(private pool: Pool) {}

  /**
   * Authorize student to access their own subscription only
   */
  authorizeStudentSubscription = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const studentId = req.params.studentId || req.user?.id;

      // Student can only access their own subscription
      if (req.user?.role === 'student' && req.user.id !== studentId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Students can only access their own subscription'
        });
      }

      // Teacher/Admin can access any student's subscription
      if (!['student', 'teacher', 'admin', 'superadmin'].includes(req.user?.role || '')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      req.studentId = studentId;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };

  /**
   * Authorize teacher to access/manage packages they created
   */
  authorizeTeacherPackage = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const packageId = req.params.packageId;

      if (req.user?.role === 'teacher') {
        // Verify teacher owns this package
        const result = await this.pool.query(
          `SELECT id FROM teacher_packages WHERE id = $1 AND teacher_id = $2`,
          [packageId, req.user.id]
        );

        if (result.rowCount === 0) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You can only manage packages you created'
          });
        }
      } else if (!['admin', 'superadmin'].includes(req.user?.role || '')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      req.teacherId = req.user?.id;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };

  /**
   * Authorize admin/superadmin only
   */
  authorizeAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!['admin', 'superadmin'].includes(req.user?.role || '')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Admin access required'
        });
      }
      next();
    } catch (error) {
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };

  /**
   * Authorize superadmin only
   */
  authorizeSuperadmin = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (req.user?.role !== 'superadmin') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Superadmin access only'
        });
      }
      next();
    } catch (error) {
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };

  /**
   * Verify student owns this subscription
   */
  verifySubscriptionOwnership = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { subscriptionId } = req.params;

      if (req.user?.role === 'student') {
        const result = await this.pool.query(
          `SELECT id FROM student_subscriptions WHERE id = $1 AND student_id = $2`,
          [subscriptionId, req.user.id]
        );

        if (result.rowCount === 0) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You do not own this subscription'
          });
        }
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };

  /**
   * Check if subscription can be modified (not expired, not in restricted state)
   */
  canModifySubscription = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { subscriptionId } = req.params;

      const result = await this.pool.query(
        `SELECT status, expiry_date FROM student_subscriptions WHERE id = $1`,
        [subscriptionId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const { status, expiry_date } = result.rows[0];
      const isExpired = new Date(expiry_date) < new Date();

      // Cannot modify expired subscriptions
      if (isExpired && status === 'expired') {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Cannot modify expired subscriptions. Please renew.'
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}
