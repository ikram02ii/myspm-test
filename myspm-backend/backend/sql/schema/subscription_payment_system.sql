-- ============================================================================
-- SUBSCRIPTION & PAYMENT SYSTEM SCHEMA
-- Education Portal - Production Grade PostgreSQL DDL
-- ============================================================================

-- ENUMS
-- ============================================================================

CREATE TYPE plan_type AS ENUM ('trial', 'free', 'mesra', 'cemerlang');
CREATE TYPE billing_cycle AS ENUM ('monthly', 'yearly');
CREATE TYPE subscription_status AS ENUM ('active', 'inactive', 'suspended', 'expired', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled');
CREATE TYPE payment_method AS ENUM ('credit_card', 'debit_card', 'online_banking', 'ewallet');

-- TABLES
-- ============================================================================

-- ============================================================================
-- PLANS TABLE
-- Defines subscription tiers with configurable features
-- ============================================================================
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    plan_type plan_type NOT NULL UNIQUE,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    billing_cycle billing_cycle,
    duration_days INTEGER,
    
    -- Feature configuration as JSON
    -- Example: {"daily_question_limit": 20, "mock_exam_access": false, ...}
    features JSONB NOT NULL DEFAULT '{}',
    
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER,
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT price_non_negative CHECK (price >= 0)
);

-- ============================================================================
-- SUBSCRIPTIONS TABLE
-- User subscriptions (direct or teacher-sponsored)
-- ============================================================================
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES plans(id),
    
    status subscription_status NOT NULL DEFAULT 'active',
    start_date DATE NOT NULL,
    end_date DATE,
    next_billing_date DATE,
    billing_cycle billing_cycle NOT NULL,
    
    is_trial BOOLEAN DEFAULT FALSE,
    auto_renew BOOLEAN DEFAULT TRUE,
    
    -- Track if subscription is sponsored by teacher
    source VARCHAR(50), -- 'direct', 'teacher_package', 'promo'
    source_id UUID, -- Reference to teacher_subscription_package if sponsored
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT valid_dates CHECK (start_date <= end_date OR end_date IS NULL)
);

-- ============================================================================
-- PROMO_CODES TABLE (Optional but Recommended)
-- Marketing codes for discounts and promotions
-- ============================================================================
CREATE TABLE promo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    
    discount_type VARCHAR(20) NOT NULL, -- 'percentage' or 'fixed'
    discount_value DECIMAL(10, 2) NOT NULL,
    
    -- Which plans this code applies to (array of plan_ids)
    applicable_plans UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    
    valid_from DATE NOT NULL,
    valid_until DATE NOT NULL,
    max_usage INTEGER, -- NULL for unlimited
    current_usage INTEGER DEFAULT 0,
    
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT discount_value_positive CHECK (discount_value > 0),
    CONSTRAINT valid_dates CHECK (valid_from <= valid_until),
    CONSTRAINT usage_valid CHECK (current_usage <= max_usage OR max_usage IS NULL)
);

-- ============================================================================
-- TEACHER_SUBSCRIPTION_PACKAGES TABLE
-- Teachers purchasing seat packages for students
-- ============================================================================
CREATE TABLE teacher_subscription_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES plans(id),
    
    total_seats INTEGER NOT NULL,
    assigned_seats INTEGER NOT NULL DEFAULT 0,
    
    billing_cycle billing_cycle NOT NULL,
    start_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    
    price_per_seat DECIMAL(10, 2) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    
    status subscription_status NOT NULL DEFAULT 'active',
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT total_seats_positive CHECK (total_seats > 0),
    CONSTRAINT assigned_seats_valid CHECK (assigned_seats >= 0 AND assigned_seats <= total_seats),
    CONSTRAINT valid_dates CHECK (start_date <= expiry_date),
    CONSTRAINT price_per_seat_positive CHECK (price_per_seat > 0)
);

-- ============================================================================
-- TEACHER_STUDENT_ASSIGNMENTS TABLE
-- Assigning teacher package seats to individual students
-- ============================================================================
CREATE TABLE teacher_student_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL REFERENCES teacher_subscription_packages(id) ON DELETE CASCADE,
    student_id UUID NOT NULL,
    
    assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date DATE NOT NULL,
    
    status subscription_status NOT NULL DEFAULT 'active',
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT valid_dates CHECK (assigned_date <= expiry_date),
    UNIQUE (package_id, student_id)
);

-- ============================================================================
-- PAYMENTS TABLE
-- Payment transactions via ToyyibPay
-- ============================================================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    
    -- Either subscription or teacher package (but typically one)
    subscription_id UUID REFERENCES subscriptions(id),
    teacher_package_id UUID REFERENCES teacher_subscription_packages(id),
    
    invoice_id UUID, -- Foreign key to invoices table
    
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'MYR',
    
    status payment_status NOT NULL DEFAULT 'pending',
    
    -- Payment provider integration
    payment_provider VARCHAR(50) NOT NULL DEFAULT 'toyyibpay',
    transaction_reference VARCHAR(255), -- Unique ID from ToyyibPay
    callback_reference VARCHAR(255), -- Reference for webhook validation
    payment_method payment_method,
    
    -- Payment timing
    paid_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    failure_reason TEXT,
    
    -- Provider-specific metadata (response, merchant info, etc)
    metadata JSONB DEFAULT '{}',
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT amount_positive CHECK (amount > 0),
    CONSTRAINT either_subscription_or_package CHECK (
        (subscription_id IS NOT NULL) OR (teacher_package_id IS NOT NULL)
    )
);

-- ============================================================================
-- INVOICES TABLE
-- Billing invoices for payments
-- ============================================================================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    payment_id UUID NOT NULL REFERENCES payments(id),
    user_id UUID NOT NULL,
    
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'MYR',
    
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    -- Statuses: draft, issued, paid, overdue, cancelled
    
    -- File storage
    invoice_url VARCHAR(500), -- URL to downloadable PDF
    
    notes TEXT,
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT amount_positive CHECK (amount > 0)
);

-- Add FK to invoices.invoice_id after invoices table is created
ALTER TABLE payments ADD CONSTRAINT fk_payments_invoice_id
    FOREIGN KEY (invoice_id) REFERENCES invoices(id);

-- ============================================================================
-- PAYMENT_LOGS TABLE
-- Audit trail for payment status transitions
-- ============================================================================
CREATE TABLE payment_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    
    action VARCHAR(50) NOT NULL,
    -- Actions: initiated, pending, processing, completed, failed, refunded, cancelled
    
    status_before payment_status,
    status_after payment_status NOT NULL,
    
    -- Provider response
    response_code VARCHAR(10),
    response_message TEXT,
    
    -- Provider-specific data
    metadata JSONB DEFAULT '{}',
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL
);

-- ============================================================================
-- SUBSCRIPTION_EVENTS TABLE
-- Track subscription lifecycle events
-- ============================================================================
CREATE TABLE subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    
    event_type VARCHAR(50) NOT NULL,
    -- Events: created, renewed, upgraded, downgraded, cancelled, suspended, expired
    
    previous_plan_id UUID REFERENCES plans(id),
    new_plan_id UUID REFERENCES plans(id),
    
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    
    -- Audit columns
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Subscriptions
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_plan_id ON subscriptions(plan_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_status ON subscriptions(status) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_end_date ON subscriptions(end_date) 
    WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_subscriptions_source ON subscriptions(source, source_id) 
    WHERE deleted_at IS NULL;

-- Payments - CRITICAL for processing
CREATE INDEX idx_payments_user_id ON payments(user_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_subscription_id ON payments(subscription_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_teacher_package_id ON payments(teacher_package_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_status ON payments(status) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_transaction_reference ON payments(transaction_reference) 
    WHERE deleted_at IS NULL AND transaction_reference IS NOT NULL;
CREATE INDEX idx_payments_callback_reference ON payments(callback_reference) 
    WHERE deleted_at IS NULL AND callback_reference IS NOT NULL;
CREATE INDEX idx_payments_created_at ON payments(created_at DESC) 
    WHERE deleted_at IS NULL;

-- Teacher Packages
CREATE INDEX idx_teacher_packages_teacher_id ON teacher_subscription_packages(teacher_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_teacher_packages_status ON teacher_subscription_packages(status) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_teacher_packages_expiry_date ON teacher_subscription_packages(expiry_date) 
    WHERE deleted_at IS NULL;

-- Teacher Student Assignments
CREATE INDEX idx_teacher_assignments_student_id ON teacher_student_assignments(student_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_teacher_assignments_package_id ON teacher_student_assignments(package_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_teacher_assignments_status ON teacher_student_assignments(status) 
    WHERE deleted_at IS NULL;

-- Invoices
CREATE INDEX idx_invoices_payment_id ON invoices(payment_id);
CREATE INDEX idx_invoices_user_id ON invoices(user_id) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_status ON invoices(status) 
    WHERE deleted_at IS NULL;

-- Payment Logs
CREATE INDEX idx_payment_logs_payment_id ON payment_logs(payment_id);
CREATE INDEX idx_payment_logs_created_at ON payment_logs(created_at DESC);

-- Subscription Events
CREATE INDEX idx_subscription_events_subscription_id ON subscription_events(subscription_id);
CREATE INDEX idx_subscription_events_event_type ON subscription_events(event_type);

-- Promo Codes
CREATE INDEX idx_promo_codes_code ON promo_codes(code) 
    WHERE deleted_at IS NULL AND is_active = TRUE;
CREATE INDEX idx_promo_codes_is_active ON promo_codes(is_active) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_promo_codes_valid_dates ON promo_codes(valid_from, valid_until) 
    WHERE deleted_at IS NULL AND is_active = TRUE;

-- ============================================================================
-- UNIQUE CONSTRAINTS
-- ============================================================================

-- Plan names must be unique
ALTER TABLE plans ADD CONSTRAINT uq_plans_name_active 
    UNIQUE (name) 
    WHERE deleted_at IS NULL;

-- Invoice numbers must be unique
ALTER TABLE invoices ADD CONSTRAINT uq_invoices_number_active 
    UNIQUE (invoice_number) 
    WHERE deleted_at IS NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE plans IS 
    'Subscription tier definitions (Trial, Free, Mesra, Cemerlang) with configurable features';

COMMENT ON COLUMN plans.features IS 
    'JSON object containing feature toggles and limits. 
    Example: {
        "daily_question_limit": 20, 
        "mock_exam_access": false, 
        "ads_enabled": true, 
        "analytics_level": "basic", 
        "ai_suggestions": false
    }';

COMMENT ON TABLE subscriptions IS 
    'User subscriptions - either direct purchase or teacher-sponsored via teacher_subscription_packages';

COMMENT ON TABLE teacher_subscription_packages IS 
    'Teacher bulk purchases: seats for their class. Each seat can be assigned to a student';

COMMENT ON TABLE teacher_student_assignments IS 
    'Individual student seat assignments from a teacher package, with expiry date';

COMMENT ON TABLE payments IS 
    'Payment transactions via ToyyibPay. One payment can be for subscription or teacher package';

COMMENT ON COLUMN payments.transaction_reference IS 
    'Unique transaction ID from ToyyibPay (required for verification)';

COMMENT ON COLUMN payments.callback_reference IS 
    'Reference for webhook callback validation (sent by payment provider)';

COMMENT ON COLUMN payments.metadata IS 
    'Stores ToyyibPay response including billCode, status, merchant info, etc';

COMMENT ON TABLE invoices IS 
    'Billing invoices linked to payments. Supports PDF generation and storage URLs';

COMMENT ON TABLE payment_logs IS 
    'Complete audit trail of payment status transitions and provider responses';

COMMENT ON TABLE subscription_events IS 
    'Subscription lifecycle tracking: creation, renewal, upgrades, cancellations, etc';

COMMENT ON TABLE promo_codes IS 
    'Marketing discount codes with expiry dates and usage limits';
