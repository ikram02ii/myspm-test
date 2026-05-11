/**
 * Teacher Routes - Sponsorship & Package Management
 * 
 * Implements teacher subscription package purchases and student seat assignments
 * 
 * Endpoints:
 * - POST /teacher/package/buy       - Purchase sponsorship package
 * - GET  /teacher/packages          - List teacher's packages
 * - POST /teacher/assign            - Assign seat to student
 * - POST /teacher/unassign          - Remove student from package
 * - GET  /teacher/students          - List assigned students
 */

import { Router, Request, Response, NextFunction } from 'express';
import { uuid } from 'uuidv4';
import { pool } from '../db';
import { authMiddleware, authorize } from '../middleware/auth';

const router = Router();

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Verify user is a teacher
 */
const requireTeacher = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (user.role !== 'teacher') {
    return res.status(403).json({ error: 'Only teachers can access this resource' });
  }
  next();
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get teacher's package by ID (with authorization check)
 */
async function getTeacherPackage(teacherId: string, packageId: string) {
  const result = await pool.query(
    `SELECT tp.*, p.name as plan_name, p.monthly_price, p.yearly_price
    FROM teacher_packages tp
    JOIN plans p ON tp.plan_id = p.id
    WHERE tp.id = $1 AND tp.teacher_id = $2 AND tp.deleted_at IS NULL`,
    [packageId, teacherId]
  );
  return result.rows[0] || null;
}

/**
 * Get student by ID
 */
async function getStudent(studentId: string) {
  const result = await pool.query(
    'SELECT id, email, full_name FROM users WHERE id = $1 AND deleted_at IS NULL',
    [studentId]
  );
  return result.rows[0] || null;
}

/**
 * Check if student has existing active subscription
 */
async function getActiveSubscription(studentId: string) {
  const result = await pool.query(
    `SELECT id, status, plan_id, expiry_date FROM subscriptions 
    WHERE user_id = $1 AND status IN ('active', 'sponsored') AND deleted_at IS NULL`,
    [studentId]
  );
  return result.rows[0] || null;
}

/**
 * Check if student already assigned to this package
 */
async function getExistingAssignment(packageId: string, studentId: string) {
  const result = await pool.query(
    `SELECT id, status FROM teacher_student_assignments 
    WHERE teacher_package_id = $1 AND student_id = $2 AND deleted_at IS NULL`,
    [packageId, studentId]
  );
  return result.rows[0] || null;
}

/**
 * Validate package availability
 */
async function validatePackageAvailability(
  packageId: string,
  teacherId: string
): Promise<{ valid: boolean; error?: string; package?: any }> {
  const pkg = await getTeacherPackage(teacherId, packageId);

  if (!pkg) {
    return { valid: false, error: 'Package not found' };
  }

  if (pkg.status !== 'active') {
    return {
      valid: false,
      error: `Package is ${pkg.status}. Cannot assign seats to ${pkg.status} package.`,
    };
  }

  if (new Date(pkg.expiry_date) < new Date()) {
    return { valid: false, error: 'Package has expired' };
  }

  if (pkg.assigned_seats >= pkg.total_seats) {
    return {
      valid: false,
      error: `Package is full (${pkg.assigned_seats}/${pkg.total_seats} seats used)`,
    };
  }

  return { valid: true, package: pkg };
}

/**
 * Create sponsored subscription for student
 */
async function createSponsoredSubscription(
  studentId: string,
  planId: string,
  assignmentId: string,
  expiryDate: string,
  teacherId: string
) {
  const subscriptionId = uuid();

  await pool.query(
    `INSERT INTO subscriptions
    (id, user_id, plan_id, status, activated_at, expiry_date, auto_renew,
     teacher_package_assignment_id, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      subscriptionId,
      studentId,
      planId,
      'sponsored',
      new Date(),
      new Date(expiryDate),
      false, // Sponsored subs don't auto-renew
      assignmentId,
      teacherId,
    ]
  );

  // Log event
  await pool.query(
    `INSERT INTO subscription_events
    (subscription_id, user_id, event_type, new_status, event_data, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      subscriptionId,
      studentId,
      'subscription_activated',
      'sponsored',
      JSON.stringify({
        sponsored_by_teacher_id: teacherId,
        assignment_id: assignmentId,
      }),
      'system',
    ]
  );

  return subscriptionId;
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /teacher/package/buy
 * Purchase a sponsorship package (seats)
 * 
 * This route handles payment creation, not payment processing itself.
 * Actual payment is processed via /payment/create endpoint.
 */
router.post(
  '/package/buy',
  authMiddleware,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teacherId = (req as any).user.id;
      const { plan_id, total_seats, billing_cycle } = req.body;

      // ===== VALIDATION =====
      if (!plan_id || !total_seats || !billing_cycle) {
        return res.status(400).json({
          error: 'Missing required fields: plan_id, total_seats, billing_cycle',
        });
      }

      if (!['monthly', 'yearly'].includes(billing_cycle)) {
        return res.status(400).json({
          error: 'Invalid billing_cycle. Must be monthly or yearly',
        });
      }

      if (total_seats < 1 || total_seats > 100) {
        return res.status(400).json({
          error: 'Invalid total_seats. Must be between 1 and 100',
        });
      }

      // ===== GET PLAN =====
      const planResult = await pool.query(
        'SELECT * FROM plans WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
        [plan_id]
      );

      if (planResult.rows.length === 0) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const plan = planResult.rows[0];

      // ===== CALCULATE AMOUNT =====
      const unitPrice =
        billing_cycle === 'monthly'
          ? plan.monthly_price
          : plan.yearly_price * (1 - plan.discount_yearly_percent / 100);

      const totalAmount = unitPrice * total_seats;

      if (totalAmount <= 0) {
        return res.status(400).json({ error: 'Invalid amount calculated' });
      }

      // ===== RETURN PAYMENT DETAILS =====
      // Teacher must complete payment via /payment/create endpoint
      return res.json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          unit_price: unitPrice,
        },
        package_details: {
          total_seats,
          billing_cycle,
          total_amount: totalAmount,
          currency: 'MYR',
          description: `${plan.name} - ${total_seats} seats - ${billing_cycle}`,
        },
        next_step: {
          message:
            'Use /payment/create endpoint to process payment',
          endpoint: 'POST /payment/create',
          body: {
            plan_id,
            billing_cycle,
            type: 'teacher_package',
            teacher_package_seats: total_seats,
          },
        },
      });
    } catch (error) {
      console.error('Package buy error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /teacher/packages
 * List teacher's sponsorship packages
 */
router.get(
  '/packages',
  authMiddleware,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teacherId = (req as any).user.id;
      const { status } = req.query;

      // ===== BUILD QUERY =====
      let query = `
        SELECT 
          tp.id, tp.plan_id, tp.total_seats, tp.assigned_seats,
          (tp.total_seats - tp.assigned_seats) as available_seats,
          tp.billing_cycle, tp.purchase_date, tp.expiry_date, tp.status,
          tp.amount_paid, tp.notes,
          p.name as plan_name, p.monthly_price, p.yearly_price,
          COUNT(tsa.id) FILTER (WHERE tsa.deleted_at IS NULL) as active_assignments
        FROM teacher_packages tp
        JOIN plans p ON tp.plan_id = p.id
        LEFT JOIN teacher_student_assignments tsa ON tp.id = tsa.teacher_package_id
        WHERE tp.teacher_id = $1 AND tp.deleted_at IS NULL
      `;

      const params: any[] = [teacherId];

      if (status) {
        query += ` AND tp.status = $2`;
        params.push(status);
      }

      query += `
        GROUP BY tp.id, p.id
        ORDER BY tp.purchase_date DESC
      `;

      const result = await pool.query(query, params);

      return res.json({
        success: true,
        packages: result.rows.map((pkg) => ({
          id: pkg.id,
          plan: {
            id: pkg.plan_id,
            name: pkg.plan_name,
          },
          seats: {
            total: pkg.total_seats,
            assigned: pkg.assigned_seats,
            available: pkg.available_seats,
          },
          billing_cycle: pkg.billing_cycle,
          amount_paid: pkg.amount_paid,
          dates: {
            purchased: pkg.purchase_date,
            expires: pkg.expiry_date,
          },
          status: pkg.status,
          active_assignments: pkg.active_assignments,
          notes: pkg.notes,
          is_valid: new Date(pkg.expiry_date) > new Date(),
        })),
        summary: {
          total_packages: result.rows.length,
          total_seats_purchased: result.rows.reduce((sum, pkg) => sum + pkg.total_seats, 0),
          total_seats_assigned: result.rows.reduce((sum, pkg) => sum + pkg.assigned_seats, 0),
        },
      });
    } catch (error) {
      console.error('List packages error:', error);
      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

/**
 * POST /teacher/assign
 * Assign student to a teacher package seat
 */
router.post(
  '/assign',
  authMiddleware,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();

    try {
      const teacherId = (req as any).user.id;
      const { package_id, student_id, notes } = req.body;

      // ===== VALIDATION =====
      if (!package_id || !student_id) {
        return res.status(400).json({
          error: 'Missing required fields: package_id, student_id',
        });
      }

      await client.query('BEGIN');

      // ===== VALIDATE PACKAGE =====
      const packageValidation = await validatePackageAvailability(
        package_id,
        teacherId
      );

      if (!packageValidation.valid) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: packageValidation.error });
      }

      const pkg = packageValidation.package;

      // ===== VALIDATE STUDENT =====
      const student = await getStudent(student_id);

      if (!student) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Student not found' });
      }

      // ===== CHECK FOR EXISTING ASSIGNMENT =====
      const existingAssignment = await getExistingAssignment(
        package_id,
        student_id
      );

      if (existingAssignment) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Student already assigned to this package',
        });
      }

      // ===== CHECK FOR ACTIVE SUBSCRIPTION =====
      const activeSubscription = await getActiveSubscription(student_id);

      if (activeSubscription) {
        // Warning but not blocking - will replace subscription
        console.warn(
          `Student ${student_id} already has active subscription ${activeSubscription.id}`
        );
      }

      // ===== CREATE ASSIGNMENT =====
      const assignmentId = uuid();

      await client.query(
        `INSERT INTO teacher_student_assignments
        (id, teacher_package_id, student_id, assigned_date, expiry_date, 
         status, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          assignmentId,
          package_id,
          student_id,
          new Date(),
          new Date(pkg.expiry_date),
          'active',
          notes || null,
          teacherId,
        ]
      );

      // ===== CREATE SPONSORED SUBSCRIPTION =====
      const subscriptionId = await createSponsoredSubscription(
        student_id,
        pkg.plan_id,
        assignmentId,
        pkg.expiry_date,
        teacherId
      );

      // ===== UPDATE ASSIGNMENT WITH SUBSCRIPTION =====
      await client.query(
        'UPDATE teacher_student_assignments SET subscription_id = $1, updated_at = $2 WHERE id = $3',
        [subscriptionId, new Date(), assignmentId]
      );

      // ===== UPDATE PACKAGE SEAT COUNT =====
      await client.query(
        'UPDATE teacher_packages SET assigned_seats = assigned_seats + 1, updated_at = $1 WHERE id = $2',
        [new Date(), package_id]
      );

      await client.query('COMMIT');

      // ===== SEND NOTIFICATION TO STUDENT =====
      // TODO: Implement notification service
      console.log(`Notify student ${student_id}: Assigned to ${pkg.plan_name} via teacher sponsorship`);

      return res.json({
        success: true,
        assignment: {
          id: assignmentId,
          package_id,
          student_id,
          student_email: student.email,
          student_name: student.full_name,
          plan_name: pkg.plan_name,
          assigned_date: new Date(),
          expiry_date: new Date(pkg.expiry_date),
          status: 'active',
        },
        subscription: {
          id: subscriptionId,
          status: 'sponsored',
          expiry_date: new Date(pkg.expiry_date),
        },
        package_status: {
          seats_remaining: pkg.total_seats - pkg.assigned_seats - 1,
          seats_total: pkg.total_seats,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Assign student error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    } finally {
      client.release();
    }
  }
);

/**
 * POST /teacher/unassign
 * Remove student from package (revoke sponsorship)
 */
router.post(
  '/unassign',
  authMiddleware,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();

    try {
      const teacherId = (req as any).user.id;
      const { assignment_id, reason } = req.body;

      // ===== VALIDATION =====
      if (!assignment_id) {
        return res.status(400).json({
          error: 'Missing required field: assignment_id',
        });
      }

      await client.query('BEGIN');

      // ===== GET ASSIGNMENT =====
      const assignmentResult = await client.query(
        `SELECT tsa.*, tp.teacher_id, tp.total_seats, tp.assigned_seats
        FROM teacher_student_assignments tsa
        JOIN teacher_packages tp ON tsa.teacher_package_id = tp.id
        WHERE tsa.id = $1 AND tp.teacher_id = $2 AND tsa.deleted_at IS NULL`,
        [assignment_id, teacherId]
      );

      if (assignmentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Assignment not found' });
      }

      const assignment = assignmentResult.rows[0];

      // ===== UPDATE ASSIGNMENT (SOFT DELETE) =====
      await client.query(
        `UPDATE teacher_student_assignments 
        SET status = $1, deleted_at = $2, updated_at = $3, updated_by = $4 
        WHERE id = $5`,
        ['expired', new Date(), new Date(), teacherId, assignment_id]
      );

      // ===== UPDATE SUBSCRIPTION TO EXPIRED =====
      const subscriptionResult = await client.query(
        'SELECT id FROM subscriptions WHERE id = $1',
        [assignment.subscription_id]
      );

      if (subscriptionResult.rows.length > 0) {
        await client.query(
          `UPDATE subscriptions 
          SET status = $1, updated_at = $2, updated_by = $3 
          WHERE id = $4`,
          ['expired', new Date(), teacherId, assignment.subscription_id]
        );

        // Log event
        await client.query(
          `INSERT INTO subscription_events
          (subscription_id, user_id, event_type, old_status, new_status, reason, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            assignment.subscription_id,
            assignment.student_id,
            'subscription_cancelled',
            'sponsored',
            'expired',
            reason || 'reassigned_by_teacher',
            teacherId,
          ]
        );
      }

      // ===== DECREMENT PACKAGE SEAT COUNT =====
      await client.query(
        'UPDATE teacher_packages SET assigned_seats = assigned_seats - 1, updated_at = $1 WHERE id = $2',
        [new Date(), assignment.teacher_package_id]
      );

      await client.query('COMMIT');

      // ===== SEND NOTIFICATION TO STUDENT =====
      console.log(`Notify student ${assignment.student_id}: Sponsorship revoked`);

      return res.json({
        success: true,
        message: 'Student removed from package',
        assignment: {
          id: assignment.id,
          student_id: assignment.student_id,
          previous_status: assignment.status,
          new_status: 'expired',
        },
        package_status: {
          seats_remaining: assignment.total_seats - (assignment.assigned_seats - 1),
          seats_total: assignment.total_seats,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Unassign student error:', error);
      return res.status(500).json({
        error: 'Internal server error',
      });
    } finally {
      client.release();
    }
  }
);

/**
 * GET /teacher/students
 * List all students assigned to teacher's packages
 */
router.get(
  '/students',
  authMiddleware,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teacherId = (req as any).user.id;
      const { status, package_id } = req.query;

      // ===== BUILD QUERY =====
      let query = `
        SELECT 
          tsa.id as assignment_id,
          tsa.teacher_package_id,
          tsa.student_id,
          tsa.assigned_date,
          tsa.expiry_date,
          tsa.status as assignment_status,
          u.email as student_email,
          u.full_name as student_name,
          s.status as subscription_status,
          tp.plan_id,
          p.name as plan_name
        FROM teacher_student_assignments tsa
        JOIN teacher_packages tp ON tsa.teacher_package_id = tp.id
        JOIN users u ON tsa.student_id = u.id
        LEFT JOIN subscriptions s ON tsa.subscription_id = s.id
        JOIN plans p ON tp.plan_id = p.id
        WHERE tp.teacher_id = $1 AND tsa.deleted_at IS NULL
      `;

      const params: any[] = [teacherId];

      if (status) {
        query += ` AND tsa.status = $${params.length + 1}`;
        params.push(status);
      }

      if (package_id) {
        query += ` AND tp.id = $${params.length + 1}`;
        params.push(package_id);
      }

      query += `
        ORDER BY tsa.assigned_date DESC
      `;

      const result = await pool.query(query, params);

      // ===== FORMAT RESPONSE =====
      const students = result.rows.map((row) => ({
        assignment_id: row.assignment_id,
        student: {
          id: row.student_id,
          email: row.student_email,
          name: row.student_name,
        },
        package: {
          id: row.teacher_package_id,
          plan: {
            id: row.plan_id,
            name: row.plan_name,
          },
        },
        assignment: {
          status: row.assignment_status,
          assigned_date: row.assigned_date,
          expiry_date: row.expiry_date,
          is_valid: new Date(row.expiry_date) > new Date(),
        },
        subscription: {
          status: row.subscription_status,
        },
      }));

      return res.json({
        success: true,
        students,
        summary: {
          total_students: students.length,
          active_assignments: students.filter(
            (s) => s.assignment.status === 'active' && s.assignment.is_valid
          ).length,
        },
      });
    } catch (error) {
      console.error('List students error:', error);
      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

export default router;
