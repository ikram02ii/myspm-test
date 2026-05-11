-- Create all tables for MySPM database

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL DEFAULT '',
  role VARCHAR(50) NOT NULL DEFAULT 'student',
  school VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  password_reset_token VARCHAR(255) UNIQUE,
  password_reset_expires TIMESTAMP,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMP,
  last_login TIMESTAMP,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMP,
  oauth_provider VARCHAR(50),
  oauth_id VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Role Permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  id SERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module VARCHAR(100) NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE
);

-- Questions table
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  subject VARCHAR(100) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  question_type VARCHAR(50) NOT NULL,
  difficulty VARCHAR(50) NOT NULL,
  question_text TEXT NOT NULL,
  options TEXT,
  correct_answer TEXT,
  explanation TEXT,
  source VARCHAR(50) NOT NULL DEFAULT 'teacher',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_by VARCHAR(255) NOT NULL DEFAULT 'System',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Exams table
CREATE TABLE IF NOT EXISTS exams (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(100) NOT NULL,
  form_level VARCHAR(50) NOT NULL,
  language_mode VARCHAR(50) DEFAULT 'english',
  timer INTEGER DEFAULT 60,
  strict_mode BOOLEAN DEFAULT FALSE,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(255) NOT NULL DEFAULT 'System',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Exam Sections table
CREATE TABLE IF NOT EXISTS exam_sections (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Exam Questions table
CREATE TABLE IF NOT EXISTS exam_questions (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES exam_sections(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Practice Sets table
CREATE TABLE IF NOT EXISTS practice_sets (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(100) NOT NULL,
  form_level VARCHAR(50) NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Practice Set Questions table
CREATE TABLE IF NOT EXISTS practice_set_questions (
  id SERIAL PRIMARY KEY,
  practice_set_id INTEGER NOT NULL REFERENCES practice_sets(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Student Results table
CREATE TABLE IF NOT EXISTS student_results (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  exam_id INTEGER NOT NULL REFERENCES exams(id),
  score REAL NOT NULL,
  total_marks INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  attempt_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attempt Answers table
CREATE TABLE IF NOT EXISTS attempt_answers (
  id SERIAL PRIMARY KEY,
  result_id INTEGER NOT NULL REFERENCES student_results(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  student_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  marks REAL NOT NULL,
  feedback TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Multiple rows per question per attempt (history)
CREATE INDEX IF NOT EXISTS attempt_answers_result_question_created_at_idx
ON attempt_answers (result_id, question_id, created_at DESC);

-- Study Notes table
CREATE TABLE IF NOT EXISTS study_notes (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(100) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  form_level VARCHAR(50) NOT NULL,
  content TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  author INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Teacher Posts table
CREATE TABLE IF NOT EXISTS teacher_posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  excerpt TEXT,
  content TEXT,
  category VARCHAR(50) NOT NULL DEFAULT 'announcement',
  audience VARCHAR(100) NOT NULL DEFAULT 'All Forms',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  author INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Assignments table
CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  exam_id INTEGER NOT NULL REFERENCES exams(id),
  due_date TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_by VARCHAR(255) NOT NULL DEFAULT 'System',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Assignment Students table
CREATE TABLE IF NOT EXISTS assignment_students (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  score REAL
);

-- Link results to an assignment seat (enforces 1 attempt per assignment seat)
ALTER TABLE student_results
  ADD COLUMN IF NOT EXISTS assignment_student_id INTEGER REFERENCES assignment_students(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS student_results_unique_assignment_student_id
ON student_results (assignment_student_id)
WHERE assignment_student_id IS NOT NULL;

-- LOV Categories table
CREATE TABLE IF NOT EXISTS lov_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100) NOT NULL UNIQUE
);

-- LOV Values table
CREATE TABLE IF NOT EXISTS lov_values (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES lov_categories(id) ON DELETE CASCADE,
  code VARCHAR(100) NOT NULL,
  display_name_en VARCHAR(255) NOT NULL,
  display_name_ms VARCHAR(255),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'active'
);

-- System Parameters table
CREATE TABLE IF NOT EXISTS system_parameters (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(100) NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
