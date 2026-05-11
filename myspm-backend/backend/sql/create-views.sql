-- Create database views for MySPM

-- Dashboard Summary View
-- Provides summary statistics for the dashboard
CREATE OR REPLACE VIEW vw_dashboard_summary AS
SELECT 
  'admin' AS role_type,
  COUNT(DISTINCT u.id) AS total_users,
  COUNT(DISTINCT CASE WHEN u.role = 'student' THEN u.id END) AS total_students,
  COUNT(DISTINCT CASE WHEN u.role = 'teacher' THEN u.id END) AS total_teachers,
  COUNT(DISTINCT e.id) AS total_exams,
  COUNT(DISTINCT es.id) AS total_exam_sections,
  COUNT(DISTINCT q.id) AS total_questions,
  COUNT(DISTINCT sr.id) AS total_exam_attempts,
  COALESCE(AVG(sr.score), 0) AS average_student_score,
  COALESCE(COUNT(DISTINCT ps.id), 0) AS total_practice_sets,
  COALESCE(COUNT(DISTINCT sn.id), 0) AS total_study_notes,
  COALESCE(COUNT(DISTINCT tp.id), 0) AS total_teacher_posts,
  NOW() AS updated_at
FROM users u
LEFT JOIN exams e ON TRUE
LEFT JOIN exam_sections es ON TRUE
LEFT JOIN questions q ON TRUE
LEFT JOIN student_results sr ON TRUE
LEFT JOIN practice_sets ps ON TRUE
LEFT JOIN study_notes sn ON TRUE
LEFT JOIN teacher_posts tp ON TRUE
GROUP BY role_type

UNION ALL

SELECT 
  'teacher' AS role_type,
  0 AS total_users,
  COUNT(DISTINCT CASE WHEN u.role = 'student' THEN u.id END) AS total_students,
  0 AS total_teachers,
  COUNT(DISTINCT e.id) AS total_exams,
  COUNT(DISTINCT es.id) AS total_exam_sections,
  COUNT(DISTINCT q.id) AS total_questions,
  COUNT(DISTINCT sr.id) AS total_exam_attempts,
  COALESCE(AVG(sr.score), 0) AS average_student_score,
  COALESCE(COUNT(DISTINCT ps.id), 0) AS total_practice_sets,
  COALESCE(COUNT(DISTINCT sn.id), 0) AS total_study_notes,
  COALESCE(COUNT(DISTINCT tp.id), 0) AS total_teacher_posts,
  NOW() AS updated_at
FROM users u
LEFT JOIN exams e ON e.created_by = u.name
LEFT JOIN exam_sections es ON e.id = es.exam_id
LEFT JOIN questions q ON q.source = 'teacher'
LEFT JOIN student_results sr ON e.id = sr.exam_id
LEFT JOIN practice_sets ps ON ps.created_by = u.id
LEFT JOIN study_notes sn ON sn.author = u.id
LEFT JOIN teacher_posts tp ON tp.author = u.id
WHERE u.role = 'teacher'
GROUP BY role_type

UNION ALL

SELECT 
  'student' AS role_type,
  0 AS total_users,
  0 AS total_students,
  0 AS total_teachers,
  COUNT(DISTINCT sr.exam_id) AS total_exams,
  0 AS total_exam_sections,
  0 AS total_questions,
  COUNT(DISTINCT sr.id) AS total_exam_attempts,
  COALESCE(AVG(sr.score), 0) AS average_student_score,
  COUNT(DISTINCT ps.id) AS total_practice_sets,
  0 AS total_study_notes,
  0 AS total_teacher_posts,
  NOW() AS updated_at
FROM users u
LEFT JOIN student_results sr ON u.id = sr.student_id
LEFT JOIN practice_set_questions psq ON TRUE
LEFT JOIN practice_sets ps ON psq.practice_set_id = ps.id
WHERE u.role = 'student'
GROUP BY role_type;


-- Exam Analytics View
-- Provides detailed analytics data for exams
CREATE OR REPLACE VIEW vw_exam_analytics AS
SELECT 
  e.id,
  e.title,
  e.subject,
  e.form_level,
  e.created_by,
  e.created_at,
  COUNT(DISTINCT es.id) AS section_count,
  COUNT(DISTINCT eq.question_id) AS question_count,
  COUNT(DISTINCT sr.id) AS attempt_count,
  COUNT(DISTINCT sr.student_id) AS unique_students,
  COALESCE(AVG(sr.score), 0) AS average_score,
  COALESCE(MIN(sr.score), 0) AS lowest_score,
  COALESCE(MAX(sr.score), 0) AS highest_score,
  COALESCE(STDDEV(sr.score), 0) AS score_stddev,
  COUNT(CASE WHEN sr.status = 'completed' THEN 1 END) AS completed_count,
  COUNT(CASE WHEN sr.status = 'in_progress' THEN 1 END) AS in_progress_count,
  COUNT(CASE WHEN sr.status = 'submitted' THEN 1 END) AS submitted_count,
  ROUND(
    CASE 
      WHEN COUNT(DISTINCT sr.student_id) = 0 THEN 0
      ELSE (COUNT(CASE WHEN sr.status = 'completed' THEN 1 END) * 100.0 / COUNT(DISTINCT sr.student_id))
    END, 
    2
  ) AS completion_percentage,
  e.status AS exam_status,
  NOW() AS updated_at
FROM exams e
LEFT JOIN exam_sections es ON e.id = es.exam_id
LEFT JOIN exam_questions eq ON es.id = eq.section_id
LEFT JOIN student_results sr ON e.id = sr.exam_id
GROUP BY 
  e.id, e.title, e.subject, e.form_level, e.created_by, 
  e.created_at, e.status
ORDER BY e.created_at DESC;

-- Question Analytics View
-- Provides analytics for individual questions
CREATE OR REPLACE VIEW vw_question_analytics AS
SELECT 
  q.id,
  q.question_text,
  q.subject,
  q.topic,
  q.question_type,
  q.difficulty,
  q.source,
  COUNT(DISTINCT aa.result_id) AS attempt_count,
  COUNT(CASE WHEN aa.is_correct THEN 1 END) AS correct_count,
  COUNT(CASE WHEN aa.is_correct = FALSE THEN 1 END) AS incorrect_count,
  ROUND(
    CASE 
      WHEN COUNT(DISTINCT aa.result_id) = 0 THEN 0
      ELSE (COUNT(CASE WHEN aa.is_correct THEN 1 END) * 100.0 / COUNT(DISTINCT aa.result_id))
    END, 
    2
  ) AS correct_percentage,
  COALESCE(AVG(aa.marks), 0) AS average_marks,
  NOW() AS updated_at
FROM questions q
LEFT JOIN attempt_answers aa ON q.id = aa.question_id
GROUP BY 
  q.id, q.question_text, q.subject, q.topic, q.question_type, 
  q.difficulty, q.source
ORDER BY attempt_count DESC;

-- Student Performance View
-- Provides performance analytics for students
CREATE OR REPLACE VIEW vw_student_performance AS
SELECT 
  u.id AS student_id,
  u.name AS student_name,
  u.email,
  u.school,
  COUNT(DISTINCT sr.id) AS exam_attempts,
  COUNT(DISTINCT sr.exam_id) AS unique_exams,
  COALESCE(AVG(sr.score), 0) AS average_score,
  COALESCE(MIN(sr.score), 0) AS lowest_score,
  COALESCE(MAX(sr.score), 0) AS highest_score,
  COUNT(CASE WHEN sr.status = 'completed' THEN 1 END) AS completed_exams,
  COUNT(CASE WHEN sr.status = 'submitted' THEN 1 END) AS submitted_exams,
  COALESCE(STDDEV(sr.score), 0) AS score_stddev,
  MAX(sr.attempt_date) AS last_attempt_date,
  NOW() AS updated_at
FROM users u
LEFT JOIN student_results sr ON u.id = sr.student_id
WHERE u.role = 'student'
GROUP BY u.id, u.name, u.email, u.school
ORDER BY average_score DESC;

-- Leaderboard Views
-- These views are shaped for mobile leaderboard UI.
-- Score is computed as weighted percentage: SUM(score) / SUM(total_marks) * 100

CREATE OR REPLACE VIEW vw_leaderboard_overall AS
WITH base AS (
  SELECT
    u.id AS user_id,
    u.name AS display_name,
    u.avatar_url,
    u.school_id,
    u.form_level,
    COUNT(sr.id) FILTER (WHERE sr.status = 'completed') AS completed_attempts,
    COUNT(sr.id) AS total_attempts,
    COALESCE(SUM(sr.score) FILTER (WHERE sr.status = 'completed'), 0) AS total_score,
    COALESCE(SUM(sr.total_marks) FILTER (WHERE sr.status = 'completed'), 0) AS total_marks,
    MAX(sr.attempt_date) FILTER (WHERE sr.status = 'completed') AS last_attempt_at
  FROM users u
  LEFT JOIN student_results sr ON sr.student_id = u.id
  WHERE u.role = 'student'
    AND COALESCE(u.status, '') = 'active'
  GROUP BY u.id, u.name, u.avatar_url, u.school_id, u.form_level
),
scored AS (
  SELECT
    b.*,
    CASE
      WHEN b.total_marks = 0 THEN 0
      ELSE (b.total_score * 100.0) / b.total_marks
    END AS score_percent
  FROM base b
),
ranked AS (
  SELECT
    DENSE_RANK() OVER (ORDER BY score_percent DESC, total_score DESC, last_attempt_at DESC NULLS LAST, user_id ASC) AS rank_overall,
    DENSE_RANK() OVER (PARTITION BY school_id ORDER BY score_percent DESC, total_score DESC, last_attempt_at DESC NULLS LAST, user_id ASC) AS rank_by_school,
    DENSE_RANK() OVER (ORDER BY score_percent DESC, total_score DESC, last_attempt_at DESC NULLS LAST, user_id ASC) AS rank,
    user_id,
    display_name,
    avatar_url,
    school_id,
    form_level,
    completed_attempts,
    total_attempts,
    total_score,
    total_marks,
    score_percent,
    last_attempt_at
  FROM scored
)
SELECT
  r.rank_overall,
  r.rank_by_school,
  r.rank,
  r.user_id,
  r.display_name,
  r.avatar_url,
  r.school_id,
  sch.name AS school_name,
  r.form_level,
  r.completed_attempts,
  r.total_attempts,
  r.total_score,
  r.total_marks,
  r.score_percent,
  r.last_attempt_at,
  NOW() AS updated_at
FROM ranked r
LEFT JOIN schools sch ON sch.id = r.school_id;

-- Per-student average exam score by subject (completed attempts only)
CREATE OR REPLACE VIEW vw_student_subject_mastery AS
SELECT
  sr.student_id,
  trim(both FROM e.subject) AS subject,
  COUNT(sr.id) AS completed_attempts,
  ROUND(COALESCE(AVG(sr.score), 0)::numeric, 1) AS avg_score_percent
FROM student_results sr
INNER JOIN exams e ON e.id = sr.exam_id
WHERE sr.status = 'completed'
  AND trim(both FROM COALESCE(e.subject, '')) <> ''
GROUP BY sr.student_id, trim(both FROM e.subject);