# Subscription Lifecycle Logic

## Subscription States

```
States:
  - trial: Free trial (3 days)
  - active: Paid subscription (Mesra/Cemerlang)
  - free: Permanent free plan (after trial expiry)
  - expired: Subscription past end_date
  - cancelled: User cancelled subscription
  - sponsored: Student assigned via teacher package

State Transitions:
  
  [User Registration]
    ↓
  [trial] ────────────────────────→ [free] (auto-downgrade after 3 days)
    ↓
  [Direct Purchase] → [active/sponsored] ←── [Teacher Assigns]
    ↓
  [User Cancels] → [cancelled] (but remains active until end_date)
    ↓
  [End Date Reached] → [expired]
    ↓
  [Auto-renew Enabled] → [active] (re-activate)
```

## User Registration Flow

### Flow: Automatic Trial Activation

```
1. User Registration:
   - POST /auth/register (email, password, name, role)
   - System creates user in users table
   
2. Trigger Trial Activation:
   - Find Trial plan → plans table (plan_type = 'trial')
   - Create subscription:
     * user_id: new user ID
     * plan_id: trial plan ID
     * status: 'active'
     * is_trial: TRUE
     * start_date: TODAY
     * end_date: TODAY + 3 days
     * billing_cycle: null
     * auto_renew: FALSE (trials don't auto-renew)
     * created_by: system_user_id
   
3. Log Event:
   - subscription_events:
     * subscription_id: newly created
     * event_type: 'created'
     * new_plan_id: trial plan ID
     * reason: 'automatic_trial_activation'
   
4. Response:
   {
     "status": "success",
     "message": "Trial activated for 3 days",
     "subscription": {
       "id": "uuid",
       "planType": "trial",
       "startDate": "2026-03-15",
       "endDate": "2026-03-18",
       "remainingDays": 3
     }
   }
```

## Student Self-Subscription Flow

### Flow: Direct Plan Purchase

```
1. Student Selects Plan:
   - GET /plans?role=student
   - Student chooses Mesra or Cemerlang
   - Selects billing_cycle: monthly or yearly
   
2. Payment Creation:
   - POST /payment/create
   - Body:
     {
       "userId": "uuid",
       "planId": "uuid",
       "billingCycle": "monthly",
       "amount": 4.90
     }
   - System creates payment:
     * payment_status: 'pending'
     * transaction_reference: null (will be filled after ToyyibPay)
     * subscription_id: not yet created
   
3. Redirect to ToyyibPay:
   - Generate bill code
   - Redirect to: https://toyyibpay.com/bill?billcode=XXXXXXXX
   
4. Payment Success Callback:
   - ToyyibPay → POST /payment/callback
   - Verify transaction with ToyyibPay API
   - Update payment:
     * status: 'completed'
     * transaction_reference: toyyibpay_tx_id
     * paid_at: NOW
   
5. Activate Subscription:
   - Create subscription:
     * user_id: student ID
     * plan_id: selected plan ID
     * status: 'active'
     * is_trial: FALSE
     * start_date: TODAY
     * end_date: TODAY + (monthly: 30 days | yearly: 365 days)
     * billing_cycle: selected cycle
     * auto_renew: TRUE (default, user can disable)
     * next_billing_date: end_date
   
6. Log Event:
   - subscription_events:
     * event_type: 'created'
     * reason: 'direct_purchase'
   
7. Generate Invoice:
   - invoices table:
     * invoice_number: auto-generated (e.g., INV-2026-001234)
     * payment_id: payment ID
     * status: 'issued'
     * invoice_url: generated PDF URL
   
8. Response & Notification:
   {
     "status": "success",
     "subscription": {
       "id": "uuid",
       "planType": "mesra",
       "billingCycle": "monthly",
       "startDate": "2026-03-15",
       "endDate": "2026-04-15",
       "autoRenew": true,
       "nextBillingDate": "2026-04-15"
     },
     "invoice": {
       "id": "uuid",
       "invoiceNumber": "INV-2026-001234",
       "invoiceUrl": "https://cdn.myspm.com/invoices/..."
     }
   }
   - Send email notification with invoice
```

## Teacher Sponsorship Flow

### Flow: Teacher Purchases Seat Package

```
1. Teacher Selects Plan & Quantity:
   - GET /teacher/package-options (returns available plans)
   - POST /teacher/packages/create
   - Body:
     {
       "teacherId": "uuid",
       "planId": "mesra_plan_id",
       "totalSeats": 30,
       "billingCycle": "yearly"
     }
   - Calculate:
     * price_per_seat = plan.price (RM4.90 for Mesra)
     * total_amount = price_per_seat × totalSeats
     * If yearly: apply 10% discount
     * total_amount = 4.90 × 30 = RM147 (monthly)
     * total_amount = (4.90 × 30) × 0.9 = RM132.30 (yearly)
   
2. Create Package Record:
   - teacher_subscription_packages:
     * teacher_id: teacher ID
     * plan_id: selected plan ID
     * total_seats: 30
     * assigned_seats: 0
     * billing_cycle: yearly
     * start_date: TODAY
     * expiry_date: TODAY + 365 days
     * price_per_seat: 4.90
     * total_amount: 132.30
     * status: 'pending_payment'
   
3. Process Payment:
   - Create payment (same as student flow)
   - Redirect to ToyyibPay
   - Receive callback
   - Update payment status to 'completed'
   
4. Activate Package:
   - teacher_subscription_packages:
     * status: 'active'
     * is_active: TRUE
   
5. Response:
   {
     "status": "success",
     "package": {
       "id": "uuid",
       "planType": "mesra",
       "totalSeats": 30,
       "availableSeats": 30,
       "expiryDate": "2027-03-15",
       "totalAmount": 132.30
     }
   }
```

### Flow: Assign Seat to Student

```
1. Teacher Initiates Assignment:
   - POST /teacher/assign
   - Body:
     {
       "packageId": "uuid",
       "studentId": "uuid"
     }
   
2. Validation:
   a. Package Exists & Active:
      - SELECT FROM teacher_subscription_packages
      - WHERE id = packageId AND teacher_id = current_user_id AND deleted_at IS NULL
      - If not found: RETURN 404
   
   b. Seats Available:
      - IF assigned_seats >= total_seats: RETURN 400 "No seats available"
   
   c. Student Not Already Assigned:
      - SELECT FROM teacher_student_assignments
      - WHERE package_id = packageId AND student_id = studentId
      - IF exists: RETURN 400 "Student already assigned"
   
   d. Student Subscription Status:
      - SELECT FROM subscriptions WHERE user_id = studentId
      - Check current subscription status
      - If active paid subscription exists: flag for user confirmation
   
3. Create Assignment:
   - teacher_student_assignments:
     * package_id: package ID
     * student_id: student ID
     * assigned_date: TODAY
     * expiry_date: package.expiry_date
     * status: 'active'
   
4. Update Package Seats:
   - UPDATE teacher_subscription_packages
   - SET assigned_seats = assigned_seats + 1
   - WHERE id = packageId
   
5. Create/Update Student Subscription:
   - Check if student has active subscription:
     * If NO: Create new subscription
       - plan_id: package.plan_id
       - status: 'active'
       - start_date: TODAY
       - end_date: package.expiry_date
       - source: 'teacher_package'
       - source_id: package_id
     * If YES (paid): Create note in metadata about override
   
6. Log Event:
   - subscription_events:
     * event_type: 'created'
     * reason: 'teacher_sponsorship'
     * metadata: { package_id, teacher_id }
   
7. Response:
   {
     "status": "success",
     "assignment": {
       "id": "uuid",
       "studentId": "uuid",
       "packageId": "uuid",
       "expiryDate": "2027-03-15",
       "status": "active"
     },
     "package": {
       "availableSeats": 29,
       "assignedSeats": 1
     }
   }
   
8. Notifications:
   - Send email to student: "You've been assigned a seat for [Plan]"
   - Show in teacher dashboard: "1 of 30 seats assigned"
```

### Flow: Reassign Seat (Remove & Reassign)

```
1. Teacher Unassigns Student:
   - POST /teacher/unassign
   - Body: { "assignmentId": "uuid" }
   
2. Validation:
   - Verify assignment belongs to teacher's package
   
3. Update Assignment:
   - teacher_student_assignments:
     * status: 'cancelled'
     * deleted_at: NOW
   
4. Update Package:
   - UPDATE teacher_subscription_packages
   - SET assigned_seats = assigned_seats - 1
   
5. Handle Student Subscription:
   - If subscription.source = 'teacher_package' AND source_id = this_package_id:
     * subscriptions.status = 'expired'
     * Mark subscription as expired
   - If subscription.source = 'direct':
     * Leave unchanged (student still has paid subscription)
   
6. Assign New Student:
   - Follow "Assign Seat to Student" flow with new student
```

## Trial Expiry Process

### Daily Cron Job: Trial Expiry Handler

```
Trigger: Every day at 2:00 AM
Job Name: handleTrialExpiry

Steps:
1. Find Expired Trial Subscriptions:
   SELECT * FROM subscriptions
   WHERE is_trial = TRUE
   AND status = 'active'
   AND end_date < NOW()
   AND deleted_at IS NULL
   
2. For Each Expired Trial:
   a. Get Free Plan:
      SELECT * FROM plans WHERE plan_type = 'free'
   
   b. Create New Subscription (Free):
      INSERT INTO subscriptions:
      - user_id: same user
      - plan_id: free plan ID
      - status: 'active'
      - start_date: TODAY
      - end_date: null (permanent)
      - is_trial: FALSE
      - auto_renew: FALSE
      - created_by: system_user_id
   
   c. Update Old Trial Subscription:
      UPDATE subscriptions
      SET status = 'expired'
      WHERE id = trial_subscription_id
   
   d. Log Event:
      INSERT INTO subscription_events:
      - event_type: 'downgraded'
      - previous_plan_id: trial_plan_id
      - new_plan_id: free_plan_id
      - reason: 'trial_expiry'
   
   e. Send Notification:
      - Email user: "Your trial has ended. You're now on the Free plan"
      - In-app notification

3. Metrics:
   - Log: "Trial expiry job completed. Processed N subscriptions"
   - Return: { processed: N, failed: 0, timestamp }
```

## Subscription Renewal Process

### Auto-Renewal (For Active Paid Subscriptions)

```
Trigger: 7 days before subscription end_date
Job: handleSubscriptionReminders + handleAutoRenewal

1. Send Renewal Reminder (7 days before):
   SELECT * FROM subscriptions
   WHERE status = 'active'
   AND auto_renew = TRUE
   AND end_date = NOW() + 7 days
   AND is_trial = FALSE
   
   For each:
   - Send email: "Your subscription renews in 7 days for RM4.90"
   - In-app notification

2. Auto-Renew Subscriptions (On end_date):
   SELECT * FROM subscriptions
   WHERE status = 'active'
   AND auto_renew = TRUE
   AND end_date = TODAY()
   
   For each:
   a. Create Payment:
      - amount: plan.price
      - status: 'processing'
   
   b. Attempt Charge:
      - Call ToyyibPay API with saved payment method
      - If success:
        * Update subscription: end_date += billing_cycle period
        * Update payment: status = 'completed'
      - If failed:
        * Update payment: status = 'failed'
        * Send notification: "Renewal failed. Update payment method"
        * Mark subscription: auto_renew = FALSE (to prevent cascading failures)

3. Manual Renewal (Teacher Packages):
   - Teacher must manually renew
   - No auto-renewal for teacher packages
   - Send email 30 days before expiry: "Your package expires in 30 days"
```

## Subscription Expiry Process

### Daily Job: Mark Expired Subscriptions

```
Trigger: Every day at 3:00 AM
Job: handleSubscriptionExpiry

1. Find Expired Active Subscriptions:
   SELECT * FROM subscriptions
   WHERE status = 'active'
   AND end_date < NOW()
   AND auto_renew = FALSE (renewal already failed or disabled)
   AND deleted_at IS NULL
   
2. For Each Expired:
   a. Update Subscription:
      UPDATE subscriptions SET status = 'expired'
   
   b. Log Event:
      - event_type: 'expired'
      - reason: 'end_date_reached'
   
   c. If Teacher Package Expiry:
      - Find all teacher_student_assignments for this package
      - Update all assignments: status = 'expired'
      - Update student subscriptions: status = 'expired'
   
   d. Send Notifications:
      - Email: "Your subscription has expired"
      - In-app: Feature access restrictions
   
3. Metrics:
   - Log expired subscriptions count
   - Alert if unexpected spike
```

## Cancellation Process

### User Cancels Subscription

```
1. User Initiates Cancellation:
   - POST /subscriptions/{id}/cancel
   - Optional: Body { "reason": "too_expensive", "feedback": "" }
   
2. Validation:
   - Verify subscription belongs to user or teacher (for package)
   
3. Update Subscription:
   - subscriptions:
     * status: 'cancelled'
     * auto_renew: FALSE
     * (end_date remains unchanged - active until end_date)
   
4. Log Event:
   - subscription_events:
     * event_type: 'cancelled'
     * reason: user-provided reason or 'user_requested'
     * metadata: { feedback, cancellation_time }
   
5. Response:
   {
     "status": "success",
     "message": "Subscription cancelled",
     "activeUntil": "2026-04-15"
   }
   
6. Notification:
   - Email: "Your subscription will expire on 2026-04-15"
   - Offer: Re-activation link with discount code
```

## Upgrade/Downgrade

### Subscription Plan Upgrade

```
1. User Initiates Upgrade:
   - POST /subscriptions/{id}/upgrade
   - Body: { "newPlanId": "uuid" }
   
2. Validation:
   - Verify new plan exists and is higher tier
   - Calculate pro-rata refund/charge (if applicable)
   
3. Create Payment (if charge required):
   - If immediate upgrade with no proration:
     * amount = new_plan.price - remaining_amount
   
4. Update Subscription:
   - Create new subscription (or update existing):
     * plan_id: newPlanId
     * status: 'active'
     * updated_at: NOW
   
5. Log Event:
   - event_type: 'upgraded'
   - previous_plan_id: old_plan_id
   - new_plan_id: new_plan_id
   
6. Notification:
   - Email: "Successfully upgraded to Cemerlang!"
```

---

## Pseudocode Implementation

### Trial Activation
```javascript
function activateTrialSubscription(userId) {
  const trialPlan = db.plans.findOne({ plan_type: 'trial' });
  
  const subscription = db.subscriptions.create({
    user_id: userId,
    plan_id: trialPlan.id,
    status: 'active',
    is_trial: true,
    start_date: today(),
    end_date: today().addDays(3),
    billing_cycle: null,
    auto_renew: false,
    created_by: SYSTEM_USER_ID
  });
  
  db.subscription_events.create({
    subscription_id: subscription.id,
    event_type: 'created',
    new_plan_id: trialPlan.id,
    reason: 'automatic_trial_activation',
    created_by: SYSTEM_USER_ID
  });
  
  return subscription;
}
```

### Assign Seat to Student
```javascript
function assignSeatToStudent(packageId, studentId, teacherId) {
  // Validation
  const pkg = db.teacher_subscription_packages.findOne({
    id: packageId,
    teacher_id: teacherId,
    deleted_at: null
  });
  
  if (!pkg) throw new Error('Package not found');
  if (pkg.assigned_seats >= pkg.total_seats) 
    throw new Error('No seats available');
  
  const existingAssignment = db.teacher_student_assignments.findOne({
    package_id: packageId,
    student_id: studentId,
    deleted_at: null
  });
  
  if (existingAssignment) 
    throw new Error('Student already assigned');
  
  // Create assignment
  const assignment = db.teacher_student_assignments.create({
    package_id: packageId,
    student_id: studentId,
    assigned_date: today(),
    expiry_date: pkg.expiry_date,
    status: 'active',
    created_by: teacherId
  });
  
  // Update package seats
  db.teacher_subscription_packages.updateOne(
    { id: packageId },
    { assigned_seats: pkg.assigned_seats + 1 }
  );
  
  // Create/Update student subscription
  let subscription = db.subscriptions.findOne({
    user_id: studentId,
    status: 'active',
    deleted_at: null
  });
  
  if (!subscription) {
    subscription = db.subscriptions.create({
      user_id: studentId,
      plan_id: pkg.plan_id,
      status: 'active',
      start_date: today(),
      end_date: pkg.expiry_date,
      source: 'teacher_package',
      source_id: packageId,
      created_by: teacherId
    });
  }
  
  // Log event
  db.subscription_events.create({
    subscription_id: subscription.id,
    event_type: 'created',
    new_plan_id: pkg.plan_id,
    reason: 'teacher_sponsorship',
    metadata: { package_id: packageId, teacher_id: teacherId },
    created_by: teacherId
  });
  
  return { assignment, subscription };
}
```

### Trial Expiry Cron Job
```javascript
async function handleTrialExpiry() {
  const freePlan = db.plans.findOne({ plan_type: 'free' });
  
  const expiredTrials = db.subscriptions.find({
    is_trial: true,
    status: 'active',
    end_date: { $lt: new Date() },
    deleted_at: null
  });
  
  for (const trial of expiredTrials) {
    // Create free plan subscription
    const newSubscription = db.subscriptions.create({
      user_id: trial.user_id,
      plan_id: freePlan.id,
      status: 'active',
      start_date: today(),
      end_date: null,
      is_trial: false,
      auto_renew: false,
      created_by: SYSTEM_USER_ID
    });
    
    // Mark trial as expired
    db.subscriptions.updateOne(
      { id: trial.id },
      { status: 'expired' }
    );
    
    // Log event
    db.subscription_events.create({
      subscription_id: trial.id,
      event_type: 'downgraded',
      previous_plan_id: trial.plan_id,
      new_plan_id: freePlan.id,
      reason: 'trial_expiry',
      created_by: SYSTEM_USER_ID
    });
    
    // Send notification
    sendEmail(trial.user.email, {
      subject: 'Your trial has ended',
      template: 'trial_ended',
      data: { user: trial.user }
    });
  }
  
  console.log(`Trial expiry job completed. Processed ${expiredTrials.length} subscriptions`);
}
```

### Seat Assignment Expiry (When Package Expires)
```javascript
async function handlePackageExpiry() {
  const expiredPackages = db.teacher_subscription_packages.find({
    status: 'active',
    expiry_date: { $lt: new Date() },
    deleted_at: null
  });
  
  for (const pkg of expiredPackages) {
    // Mark package as expired
    db.teacher_subscription_packages.updateOne(
      { id: pkg.id },
      { status: 'expired' }
    );
    
    // Find all assignments for this package
    const assignments = db.teacher_student_assignments.find({
      package_id: pkg.id,
      status: 'active',
      deleted_at: null
    });
    
    for (const assignment of assignments) {
      // Mark assignment as expired
      db.teacher_student_assignments.updateOne(
        { id: assignment.id },
        { status: 'expired' }
      );
      
      // Find student subscription from this package
      const subscription = db.subscriptions.findOne({
        user_id: assignment.student_id,
        source: 'teacher_package',
        source_id: pkg.id
      });
      
      if (subscription) {
        // Mark subscription as expired
        db.subscriptions.updateOne(
          { id: subscription.id },
          { status: 'expired' }
        );
        
        // Send notification to student
        sendEmail(subscription.user.email, {
          subject: 'Your sponsored subscription has expired',
          template: 'sponsorship_expired'
        });
      }
    }
  }
}
```
