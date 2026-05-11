-- ============================================================================
-- MySPM SUBSCRIPTION AND PAYMENT MODULE - DATABASE SCHEMA
-- ============================================================================
-- Complete PostgreSQL schema for subscription lifecycle, payments, and
-- teacher sponsorship system.
--
-- Enums, Tables, Indexes, and Constraints
-- ============================================================================

-- ============================================================================
-- ENUMS
-- ============================================================================

-- Plan types available in the system
CREATE TYPE plan_type AS ENUM (
  'trial',      -- 3-day free trial, full features
  'free',       -- Permanent free plan with limitations
  'mesra',      -- RM4.90/month basic paid plan
  'cemerlang'   -- RM14.90/month premium paid plan
);

-- Billing cycle options
CREATE TYPE billing_cycle AS ENUM (
  'monthly',    -- Monthly subscription
  'yearly'      -- Yearly subscription (with discount)
);

-- Subscription status states
CREATE TYPE subscription_status AS ENUM (
  'trial',      -- User in trial period
  'active',     -- Subscription is active and valid
  'expired',    -- Subscription has expired
  'cancelled',  -- User cancelled subscription
  'sponsored'   -- Subscription provided via teacher sponsorship
);

-- Payment status states
CREATE TYPE payment_status AS ENUM (
  'pending',    -- Payment created, awaiting user action
  'processing', -- Payment submitted to gateway
  'completed',  -- Payment successfully processed
  'failed',     -- Payment failed
  'refunded',   -- Payment refunded
  'expired'     -- Payment request expired
);

-- Invoice status
CREATE TYPE invoice_status AS ENUM (
  'draft',      -- Invoice generated but not finalized
  'issued',     -- Invoice issued and sent
  'paid',       -- Payment received
  'cancelled'   -- Invoice cancelled
);

-- Teacher package status
CREATE TYPE package_status AS ENUM (
  'active',     -- Package is currently active
  'expired',    -- Package has expired
  'cancelled'   -- Package was cancelled
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1. SUBSCRIPTION PLANS
-- Stores plan definitions and feature configurations
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Info
  plan_type plan_type NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- Pricing
  monthly_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  yearly_price DECIMAL(10, 2),
  currency VARCHAR(3) DEFAULT 'MYR',
  discount_yearly_percent DECIMAL(5, 2) DEFAULT 0,
  
  -- Feature Configuration (JSON)
  -- Stores plan-specific feature limits and settings
  features JSONB NOT NULL DEFAULT '{
    "daily_question_limit": 20,
    "ads_enabled": true,
    "mock_exam_access": false,
    "analytics_level": "basic",
    "ai_suggestions": false,
    "custom_study_paths": false,
    "teacher_analytics": false,
    "class_management": false
  }'::jsonb,
  
  -- Metadata
  trial_duration_days INTEGER,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT plan_price_positive CHECK (monthly_price >= 0 AND (yearly_price IS NULL OR yearly_price >= 0))
);

-- 2. USER SUBSCRIPTIONS
-- Tracks active subscriptions for each user
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User Reference
  user_id UUID NOT NULL,
  
  -- Subscription Details
  plan_id UUID NOT NULL REFERENCES plans(id),
  status subscription_status NOT NULL DEFAULT 'trial',
  billing_cycle billing_cycle,
  
  -- Dates
  activated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  auto_renew BOOLEAN DEFAULT true,
  
  -- Related IDs
  payment_id UUID,
  invoice_id UUID,
  teacher_package_assignment_id UUID,
  
  -- Notes
  cancellation_reason TEXT,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  updated_by UUID,
  
  CONSTRAINT expiry_after_activation CHECK (expiry_date > activated_at),
  CONSTRAINT cancel_after_creation CHECK (cancelled_at IS NULL OR cancelled_at >= created_at)
);

-- 3. TEACHER SPONSORSHIP PACKAGES
-- Teachers purchase seats to sponsor students
CREATE TABLE teacher_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Teacher Reference
  teacher_id UUID NOT NULL,
  
  -- Package Details
  plan_id UUID NOT NULL REFERENCES plans(id),
  billing_cycle billing_cycle NOT NULL,
  
  -- Seat Management
  total_seats INTEGER NOT NULL,
  assigned_seats INTEGER DEFAULT 0,
  
  -- Dates
  purchase_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status package_status DEFAULT 'active',
  
  -- Payment
  payment_id UUID,
  amount_paid DECIMAL(10, 2),
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  updated_by UUID,
  
  CONSTRAINT seats_assigned_valid CHECK (assigned_seats <= total_seats AND assigned_seats >= 0),
  CONSTRAINT expiry_after_purchase CHECK (expiry_date > purchase_date)
);

-- 4. TEACHER-STUDENT SEAT ASSIGNMENTS
-- Maps sponsored subscriptions to students
CREATE TABLE teacher_student_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  teacher_package_id UUID NOT NULL REFERENCES teacher_packages(id),
  student_id UUID NOT NULL,
  
  -- Dates
  assigned_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status package_status DEFAULT 'active',
  
  -- Related subscription
  subscription_id UUID REFERENCES subscriptions(id),
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  updated_by UUID,
  
  CONSTRAINT expiry_after_assignment CHECK (expiry_date > assigned_date),
  UNIQUE(teacher_package_id, student_id, deleted_at IS NULL)
);

-- 5. PAYMENTS
-- Records all payment transactions via ToyyibPay
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User & Subscription
  user_id UUID NOT NULL,
  subscription_id UUID REFERENCES subscriptions(id),
  teacher_package_id UUID REFERENCES teacher_packages(id),
  plan_id UUID NOT NULL REFERENCES plans(id),
  
  -- Amount & Currency
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'MYR',
  
  -- Payment Status
  status payment_status DEFAULT 'pending',
  
  -- ToyyibPay Integration
  payment_provider VARCHAR(50) DEFAULT 'toyyibpay',
  transaction_reference VARCHAR(255) UNIQUE,
  callback_reference VARCHAR(255) UNIQUE,
  payment_method VARCHAR(50),
  payment_channel VARCHAR(50),
  
  -- Metadata
  billing_cycle billing_cycle,
  description TEXT,
  
  -- Callback Data (JSON)
  callback_data JSONB,
  
  -- Dates
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  updated_by UUID,
  
  CONSTRAINT amount_positive CHECK (amount > 0),
  CONSTRAINT either_subscription_or_package CHECK (
    (subscription_id IS NOT NULL AND teacher_package_id IS NULL) OR
    (subscription_id IS NULL AND teacher_package_id IS NOT NULL)
  )
);

-- 6. INVOICES
-- Invoice records for payments and subscriptions
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  user_id UUID NOT NULL,
  payment_id UUID REFERENCES payments(id),
  subscription_id UUID REFERENCES subscriptions(id),
  teacher_package_id UUID REFERENCES teacher_packages(id),
  
  -- Invoice Details
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  invoice_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date TIMESTAMP WITH TIME ZONE,
  status invoice_status DEFAULT 'draft',
  
  -- Amount
  sub_total DECIMAL(10, 2),
  tax_amount DECIMAL(10, 2) DEFAULT 0,
  total_amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'MYR',
  
  -- URLs & Files
  invoice_url VARCHAR(500),
  pdf_url VARCHAR(500),
  
  -- Metadata
  description TEXT,
  notes TEXT,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  updated_by UUID
);

-- 7. PAYMENT LOGS
-- Audit trail for all payment transactions and callbacks
CREATE TABLE payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference
  payment_id UUID NOT NULL REFERENCES payments(id),
  
  -- Log Details
  event_type VARCHAR(100) NOT NULL,
  status payment_status,
  
  -- Request/Response Data (JSON)
  request_data JSONB,
  response_data JSONB,
  callback_data JSONB,
  
  -- Error Handling
  error_message TEXT,
  error_code VARCHAR(50),
  retry_count INTEGER DEFAULT 0,
  
  -- Metadata
  ip_address INET,
  user_agent TEXT,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID
);

-- 8. SUBSCRIPTION EVENTS
-- Audit trail for subscription lifecycle events
CREATE TABLE subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference
  subscription_id UUID NOT NULL REFERENCES subscriptions(id),
  user_id UUID NOT NULL,
  
  -- Event Details
  event_type VARCHAR(100) NOT NULL,
  old_status subscription_status,
  new_status subscription_status,
  
  -- Event Data (JSON)
  event_data JSONB,
  reason TEXT,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Subscriptions
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_plan_id ON subscriptions(plan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_status ON subscriptions(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_expiry ON subscriptions(expiry_date) WHERE status != 'expired' AND deleted_at IS NULL;
CREATE INDEX idx_subscriptions_active_users ON subscriptions(user_id) WHERE status = 'active' AND deleted_at IS NULL;

-- Teacher Packages
CREATE INDEX idx_teacher_packages_teacher_id ON teacher_packages(teacher_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_teacher_packages_plan_id ON teacher_packages(plan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_teacher_packages_status ON teacher_packages(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_teacher_packages_expiry ON teacher_packages(expiry_date) WHERE status = 'active' AND deleted_at IS NULL;

-- Teacher-Student Assignments
CREATE INDEX idx_assignments_teacher_package_id ON teacher_student_assignments(teacher_package_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assignments_student_id ON teacher_student_assignments(student_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assignments_status ON teacher_student_assignments(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_assignments_expiry ON teacher_student_assignments(expiry_date) WHERE status = 'active' AND deleted_at IS NULL;

-- Payments
CREATE INDEX idx_payments_user_id ON payments(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_status ON payments(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_transaction_ref ON payments(transaction_reference) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_created_at ON payments(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_subscription_id ON payments(subscription_id) WHERE deleted_at IS NULL;

-- Invoices
CREATE INDEX idx_invoices_user_id ON invoices(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_status ON invoices(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_created_at ON invoices(created_at DESC) WHERE deleted_at IS NULL;

-- Payment Logs
CREATE INDEX idx_payment_logs_payment_id ON payment_logs(payment_id);
CREATE INDEX idx_payment_logs_event_type ON payment_logs(event_type);
CREATE INDEX idx_payment_logs_created_at ON payment_logs(created_at DESC);

-- Subscription Events
CREATE INDEX idx_subscription_events_subscription_id ON subscription_events(subscription_id);
CREATE INDEX idx_subscription_events_user_id ON subscription_events(user_id);
CREATE INDEX idx_subscription_events_event_type ON subscription_events(event_type);
CREATE INDEX idx_subscription_events_created_at ON subscription_events(created_at DESC);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active subscriptions for reporting
CREATE VIEW active_subscriptions AS
SELECT 
  s.id,
  s.user_id,
  s.plan_id,
  p.plan_type,
  p.name as plan_name,
  s.status,
  s.expiry_date,
  s.auto_renew,
  NOW() < s.expiry_date as is_valid,
  (s.expiry_date - NOW()) as days_remaining
FROM subscriptions s
JOIN plans p ON s.plan_id = p.id
WHERE s.deleted_at IS NULL AND s.status IN ('trial', 'active', 'sponsored');

-- Teacher package summary
CREATE VIEW teacher_package_summary AS
SELECT 
  tp.id,
  tp.teacher_id,
  tp.plan_id,
  p.name as plan_name,
  tp.total_seats,
  tp.assigned_seats,
  (tp.total_seats - tp.assigned_seats) as available_seats,
  tp.expiry_date,
  tp.status,
  NOW() < tp.expiry_date as is_valid
FROM teacher_packages tp
JOIN plans p ON tp.plan_id = p.id
WHERE tp.deleted_at IS NULL;

-- Upcoming subscription expirations (next 7 days)
CREATE VIEW upcoming_expirations AS
SELECT 
  s.id,
  s.user_id,
  s.plan_id,
  p.name as plan_name,
  s.expiry_date,
  (s.expiry_date - NOW())::interval as time_until_expiry
FROM subscriptions s
JOIN plans p ON s.plan_id = p.id
WHERE s.deleted_at IS NULL 
  AND s.status IN ('active', 'sponsored')
  AND s.expiry_date BETWEEN NOW() AND NOW() + interval '7 days'
ORDER BY s.expiry_date ASC;

-- Payment summary by status
CREATE VIEW payment_summary AS
SELECT 
  status,
  COUNT(*) as count,
  SUM(amount) as total_amount,
  AVG(amount) as avg_amount
FROM payments
WHERE deleted_at IS NULL
GROUP BY status;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE plans IS 'Plan definitions with pricing and feature configurations';
COMMENT ON TABLE subscriptions IS 'User subscription records including trial, active, expired, and sponsored states';
COMMENT ON TABLE teacher_packages IS 'Sponsorship packages purchased by teachers to provide student seats';
COMMENT ON TABLE teacher_student_assignments IS 'Maps individual student subscriptions to teacher sponsor packages';
COMMENT ON TABLE payments IS 'Payment transaction records including ToyyibPay gateway integration';
COMMENT ON TABLE invoices IS 'Invoice records for payments and subscription records';
COMMENT ON TABLE payment_logs IS 'Audit trail for all payment events and API callbacks';
COMMENT ON TABLE subscription_events IS 'Audit trail for subscription lifecycle changes';

COMMENT ON COLUMN subscriptions.status IS 'Current subscription state: trial, active, expired, cancelled, sponsored';
COMMENT ON COLUMN subscriptions.auto_renew IS 'Whether subscription auto-renews (false after cancellation)';
COMMENT ON COLUMN plans.features IS 'JSON config: daily_question_limit, ads_enabled, mock_exam_access, analytics_level, ai_suggestions, etc.';
COMMENT ON COLUMN payments.transaction_reference IS 'ToyyibPay billCode from payment creation';
COMMENT ON COLUMN payments.callback_reference IS 'ToyyibPay callbackReference from callback notification';

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
