-- Seed data for MySPM database

-- Insert sample users
INSERT INTO users (name, email, password, role, school, status) VALUES
('Admin User', 'admin@myspm.com', 'admin123', 'admin', 'MySPM Admin', 'active'),
('John Teacher', 'teacher@myspm.com', 'teacher123', 'teacher', 'Secondary School', 'active'),
('Jane Student', 'student@myspm.com', 'student123', 'student', 'Secondary School', 'active'),
('Ali Student', 'ali@myspm.com', 'student123', 'student', 'Secondary School', 'active'),
('Fatima Student', 'fatima@myspm.com', 'student123', 'student', 'Secondary School', 'active')
ON CONFLICT (email) DO NOTHING;

-- Insert sample roles
INSERT INTO roles (name, description) VALUES
('admin', 'Administrator with full access'),
('teacher', 'Teacher who can create exams and view student results'),
('student', 'Student who can take exams and practice'),
('parent', 'Parent who can view student progress')
ON CONFLICT (name) DO NOTHING;

-- Insert role permissions
INSERT INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) VALUES
((SELECT id FROM roles WHERE name = 'admin'), 'exams', true, true, true, true),
((SELECT id FROM roles WHERE name = 'admin'), 'users', true, true, true, true),
((SELECT id FROM roles WHERE name = 'admin'), 'reports', true, true, true, true),
((SELECT id FROM roles WHERE name = 'teacher'), 'exams', true, true, true, false),
((SELECT id FROM roles WHERE name = 'teacher'), 'questions', true, true, true, false),
((SELECT id FROM roles WHERE name = 'teacher'), 'results', true, false, false, false),
((SELECT id FROM roles WHERE name = 'student'), 'exams', true, false, false, false),
((SELECT id FROM roles WHERE name = 'student'), 'results', true, false, false, false)
ON CONFLICT DO NOTHING;

-- Insert sample questions
INSERT INTO questions (subject, topic, question_type, difficulty, question_text, options, correct_answer, explanation, source, status, created_by) VALUES
('Mathematics', 'Algebra', 'multiple_choice', 'easy', 'What is 2 + 2?', '[\"3\", \"4\", \"5\", \"6\"]', '1', 'Basic addition: 2 + 2 = 4', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Algebra', 'multiple_choice', 'medium', 'Solve for x: 2x + 3 = 7', '[\"1\", \"2\", \"3\", \"4\"]', '1', 'x = (7-3)/2 = 2', 'teacher', 'active', 'John Teacher'),
('Science', 'Physics', 'multiple_choice', 'easy', 'What is the SI unit of velocity?', '[\"m/s\", \"km/h\", \"mph\", \"ft/s\"]', '0', 'The SI unit of velocity is meters per second (m/s)', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'medium', 'How many chromosomes do humans have?', '[\"23\", \"46\", \"48\", \"92\"]', '1', 'Humans have 46 chromosomes (23 pairs)', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'medium', 'Who wrote Romeo and Juliet?', '[\"William Wordsworth\", \"William Shakespeare\", \"Jane Austen\", \"Charles Dickens\"]', '1', 'William Shakespeare wrote Romeo and Juliet', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Geometry', 'multiple_choice', 'hard', 'Calculate the area of a circle with radius 5cm', '[\"25π\", \"10π\", \"50π\", \"100π\"]', '0', 'Area = πr² = π(5)² = 25π cm²', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Algebra', 'multiple_choice', 'easy', 'If y = 2x and x = 5, what is y?', '[\"5\", \"7\", \"10\", \"12\"]', '2', 'Substitute x = 5: y = 2 × 5 = 10', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Algebra', 'multiple_choice', 'easy', 'What is 12 ÷ 3?', '[\"2\", \"3\", \"4\", \"6\"]', '2', '12 ÷ 3 = 4', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Algebra', 'multiple_choice', 'medium', 'Expand (x + 2)(x + 3)', '[\"x² + 5x + 6\", \"x² + 6x + 5\", \"x² + 5x + 5\", \"2x + 5\"]', '0', '(x+2)(x+3) = x² + 3x + 2x + 6', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Algebra', 'multiple_choice', 'easy', 'Perimeter of a square with side 4 cm?', '[\"4\", \"8\", \"12\", \"16\"]', '3', '4 × side = 16 cm', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Algebra', 'multiple_choice', 'easy', 'Solve: x − 5 = 10', '[\"5\", \"10\", \"15\", \"20\"]', '2', 'x = 10 + 5 = 15', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Algebra', 'multiple_choice', 'medium', 'Which is greater: 0.5 or 1/3?', '[\"0.5\", \"1/3\", \"Equal\", \"Cannot tell\"]', '0', '0.5 = 1/2 > 1/3', 'teacher', 'active', 'John Teacher'),
('Mathematics', 'Algebra', 'multiple_choice', 'easy', 'What is 10% of 200?', '[\"2\", \"10\", \"20\", \"40\"]', '2', '10% × 200 = 20', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'easy', 'Which organelle is the powerhouse of the cell?', '[\"Nucleus\", \"Mitochondria\", \"Ribosome\", \"Golgi\"]', '1', 'Mitochondria produce ATP', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'easy', 'Which gas do plants mainly absorb for photosynthesis?', '[\"Oxygen\", \"Nitrogen\", \"Carbon dioxide\", \"Hydrogen\"]', '2', 'CO₂ is fixed in photosynthesis', 'teacher', 'active', 'John Teacher'),
('Science', 'Chemistry', 'multiple_choice', 'easy', 'What is the common name for H₂O?', '[\"Salt\", \"Water\", \"Ammonia\", \"Oxygen\"]', '1', 'H₂O is water', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'medium', 'Photosynthesis mainly occurs in which plant part?', '[\"Root\", \"Stem\", \"Leaf\", \"Flower\"]', '2', 'Chloroplasts are abundant in leaves', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'easy', 'DNA stands for?', '[\"Dynamic Nucleic Acid\", \"Deoxyribonucleic acid\", \"Diacid Nitrogen Assembly\", \"Dense Nuclear Array\"]', '1', 'Full name of DNA', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'medium', 'Enzymes are mostly made of?', '[\"Lipids\", \"Proteins\", \"Carbohydrates\", \"DNA\"]', '1', 'Enzymes are proteins (mostly)', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'easy', 'The basic unit of life is?', '[\"Organ\", \"Tissue\", \"Cell\", \"Molecule\"]', '2', 'Cell theory', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'medium', 'Which blood component carries oxygen?', '[\"Plasma\", \"Platelets\", \"White blood cells\", \"Red blood cells\"]', '3', 'Haemoglobin in RBCs binds O₂', 'teacher', 'active', 'John Teacher'),
('Science', 'Physics', 'multiple_choice', 'medium', 'Speed = distance ÷ ?', '[\"Time\", \"Mass\", \"Force\", \"Area\"]', '0', 'v = d/t', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'easy', 'Which vitamin is produced in skin with sunlight?', '[\"A\", \"B12\", \"C\", \"D\"]', '3', 'Vitamin D synthesis in skin', 'teacher', 'active', 'John Teacher'),
('Science', 'Chemistry', 'multiple_choice', 'medium', 'pH 7 is considered?', '[\"Acidic\", \"Neutral\", \"Basic\", \"Saline\"]', '1', 'pH 7 is neutral', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'easy', 'Osmosis is the movement of?', '[\"Solute\", \"Solvent\", \"Both equally\", \"Heat\"]', '1', 'Water/solvent across membrane', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'medium', 'Which organ filters blood and produces urine?', '[\"Heart\", \"Lung\", \"Kidney\", \"Liver\"]', '2', 'Kidney function', 'teacher', 'active', 'John Teacher'),
('Science', 'Biology', 'multiple_choice', 'easy', 'Animals that maintain constant body temperature are?', '[\"Poikilotherms\", \"Homeotherms\", \"Hibernate\", \"Amphibians only\"]', '1', 'Homeotherms / warm-blooded', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'medium', 'Who wrote Macbeth?', '[\"Chaucer\", \"Shakespeare\", \"Milton\", \"Keats\"]', '1', 'Shakespeare', 'teacher', 'active', 'John Teacher'),
('English', 'Grammar', 'multiple_choice', 'easy', 'A naming word for a person, place, or thing is a?', '[\"Verb\", \"Noun\", \"Adjective\", \"Adverb\"]', '1', 'Definition of noun', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'medium', 'Hamlet is a?', '[\"Sonnet\", \"Tragedy\", \"Comedy\", \"Essay\"]', '1', 'Tragic play', 'teacher', 'active', 'John Teacher'),
('English', 'Writing', 'multiple_choice', 'easy', 'The main idea of a paragraph is often in the?', '[\"Last sentence only\", \"Topic sentence\", \"Footnote\", \"Margin\"]', '1', 'Topic sentence guides the paragraph', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'easy', 'A comparison using "like" or "as" is?', '[\"Metaphor\", \"Simile\", \"Irony\", \"Oxymoron\"]', '1', 'Simile uses like/as', 'teacher', 'active', 'John Teacher'),
('English', 'Grammar', 'multiple_choice', 'medium', 'Choose the correct plural: child → ?', '[\"childs\", \"children\", \"childes\", \"childrens\"]', '1', 'Irregular plural', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'medium', 'Which poetry form has 14 lines?', '[\"Haiku\", \"Sonnet\", \"Limerick\", \"Ballad\"]', '1', 'Sonnet', 'teacher', 'active', 'John Teacher'),
('English', 'Comprehension', 'multiple_choice', 'easy', 'The attitude of a narrator toward the subject is?', '[\"Plot\", \"Tone\", \"Setting\", \"Theme\"]', '1', 'Tone', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'hard', 'Who wrote "Paradise Lost"?', '[\"Shakespeare\", \"Milton\", \"Wordsworth\", \"Donne\"]', '1', 'John Milton', 'teacher', 'active', 'John Teacher'),
('English', 'Writing', 'multiple_choice', 'medium', 'A statement that presents the opposite of truth for effect is?', '[\"Hyperbole\", \"Irony\", \"Alliteration\", \"Anaphora\"]', '1', 'Verbal irony', 'teacher', 'active', 'John Teacher'),
('English', 'Grammar', 'multiple_choice', 'easy', 'Past tense of "go"?', '[\"goed\", \"went\", \"gone\", \"going\"]', '1', 'Irregular verb', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'easy', 'Juliet appears in which play?', '[\"Hamlet\", \"Romeo and Juliet\", \"Othello\", \"King Lear\"]', '1', 'Title reference', 'teacher', 'active', 'John Teacher'),
('English', 'Summary', 'multiple_choice', 'medium', 'Skimming is useful for?', '[\"Memorising spellings\", \"Getting main ideas quickly\", \"Solving equations\", \"Diagram labelling\"]', '1', 'Reading strategy', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'medium', 'Beowulf is an example of?', '[\"Modern novel\", \"Old English epic\", \"Victorian essay\", \"Romantic lyric\"]', '1', 'Old English epic', 'teacher', 'active', 'John Teacher'),
('English', 'Grammar', 'multiple_choice', 'medium', 'Which is a compound sentence?', '[\"I ran.\", \"I ran and she walked.\", \"Running fast.\", \"Because I ran.\"]', '1', 'Two independent clauses joined', 'teacher', 'active', 'John Teacher'),
('English', 'Writing', 'multiple_choice', 'easy', 'Dear Sir/Madam closes are common in?', '[\"Informal texts\", \"Formal letters\", \"Text messages\", \"Memes\"]', '1', 'Formal register', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'easy', 'Prose is?', '[\"Rhymed verse only\", \"Ordinary written language\", \"Japanese form\", \"Stage direction only\"]', '1', 'Prose definition', 'teacher', 'active', 'John Teacher'),
('English', 'Comprehension', 'multiple_choice', 'medium', 'Context clues help the reader?', '[\"Ignore unknown words\", \"Infer word meanings\", \"Skip paragraphs\", \"Avoid the topic\"]', '1', 'Vocabulary from context', 'teacher', 'active', 'John Teacher'),
('English', 'Literature', 'multiple_choice', 'medium', 'Which period is William Wordsworth linked to?', '[\"Elizabethan\", \"Romantic\", \"Victorian\", \"Modernist\"]', '1', 'Romantic period poet', 'teacher', 'active', 'John Teacher')
ON CONFLICT DO NOTHING;

-- Insert sample exams
INSERT INTO exams (title, subject, form_level, language_mode, timer, strict_mode, status, created_by) VALUES
('Form 4 Mathematics Mid-Term', 'Mathematics', 'Form 4', 'english', 120, false, 'active', 'John Teacher'),
('SPM Biology Practice Test', 'Science', 'Form 5', 'english', 90, true, 'active', 'John Teacher'),
('English Language Diagnostic Test', 'English', 'Form 4', 'english', 60, false, 'draft', 'John Teacher')
ON CONFLICT DO NOTHING;

-- Insert sample exam sections
INSERT INTO exam_sections (exam_id, name, sort_order) VALUES
((SELECT id FROM exams WHERE title = 'Form 4 Mathematics Mid-Term'), 'Section A: Multiple Choice', 0),
((SELECT id FROM exams WHERE title = 'Form 4 Mathematics Mid-Term'), 'Section B: Short Answer', 1),
((SELECT id FROM exams WHERE title = 'SPM Biology Practice Test'), 'Part 1: MCQ', 0),
((SELECT id FROM exams WHERE title = 'SPM Biology Practice Test'), 'Part 2: Structured Questions', 1)
ON CONFLICT DO NOTHING;

-- Insert sample exam questions (linking questions to exam sections)
INSERT INTO exam_questions (section_id, question_id, sort_order) VALUES
((SELECT id FROM exam_sections WHERE name = 'Section A: Multiple Choice'), (SELECT id FROM questions WHERE question_text = 'What is 2 + 2?' LIMIT 1), 0),
((SELECT id FROM exam_sections WHERE name = 'Section A: Multiple Choice'), (SELECT id FROM questions WHERE question_text = 'Solve for x: 2x + 3 = 7' LIMIT 1), 1),
((SELECT id FROM exam_sections WHERE name = 'Section B: Short Answer'), (SELECT id FROM questions WHERE question_text = 'Calculate the area of a circle with radius 5cm' LIMIT 1), 0),
((SELECT id FROM exam_sections WHERE name = 'Part 1: MCQ'), (SELECT id FROM questions WHERE question_text = 'How many chromosomes do humans have?' LIMIT 1), 0),
((SELECT id FROM exam_sections WHERE name = 'Part 1: MCQ'), (SELECT id FROM questions WHERE question_text = 'What is the SI unit of velocity?' LIMIT 1), 1)
ON CONFLICT DO NOTHING;

-- Insert sample practice sets (question_count matches practice_set_questions rows per set)
INSERT INTO practice_sets (title, subject, form_level, question_count, status, created_by) VALUES
('Algebra Basics Practice', 'Mathematics', 'Form 4', 10, 'active', (SELECT id FROM users WHERE role = 'teacher' LIMIT 1)),
('Biology Fundamentals', 'Science', 'Form 4', 15, 'active', (SELECT id FROM users WHERE role = 'teacher' LIMIT 1)),
('Shakespeare Study Guide', 'English', 'Form 5', 20, 'draft', (SELECT id FROM users WHERE role = 'teacher' LIMIT 1))
ON CONFLICT DO NOTHING;

-- Practice set ↔ questions: only link rows where questions.subject = practice_sets.subject
INSERT INTO practice_set_questions (practice_set_id, question_id, sort_order)
SELECT ps.id, q.id, v.sort_order
FROM (
  VALUES
    ('Algebra Basics Practice'::text, 'What is 2 + 2?'::text, 0::int),
    ('Algebra Basics Practice', 'Solve for x: 2x + 3 = 7', 1),
    ('Algebra Basics Practice', 'Calculate the area of a circle with radius 5cm', 2),
    ('Algebra Basics Practice', 'If y = 2x and x = 5, what is y?', 3),
    ('Algebra Basics Practice', 'What is 12 ÷ 3?', 4),
    ('Algebra Basics Practice', 'Expand (x + 2)(x + 3)', 5),
    ('Algebra Basics Practice', 'Perimeter of a square with side 4 cm?', 6),
    ('Algebra Basics Practice', 'Solve: x − 5 = 10', 7),
    ('Algebra Basics Practice', 'Which is greater: 0.5 or 1/3?', 8),
    ('Algebra Basics Practice', 'What is 10% of 200?', 9),
    ('Biology Fundamentals', 'What is the SI unit of velocity?', 0),
    ('Biology Fundamentals', 'How many chromosomes do humans have?', 1),
    ('Biology Fundamentals', 'Which organelle is the powerhouse of the cell?', 2),
    ('Biology Fundamentals', 'Which gas do plants mainly absorb for photosynthesis?', 3),
    ('Biology Fundamentals', 'What is the common name for H₂O?', 4),
    ('Biology Fundamentals', 'Photosynthesis mainly occurs in which plant part?', 5),
    ('Biology Fundamentals', 'DNA stands for?', 6),
    ('Biology Fundamentals', 'Enzymes are mostly made of?', 7),
    ('Biology Fundamentals', 'The basic unit of life is?', 8),
    ('Biology Fundamentals', 'Which blood component carries oxygen?', 9),
    ('Biology Fundamentals', 'Speed = distance ÷ ?', 10),
    ('Biology Fundamentals', 'Which vitamin is produced in skin with sunlight?', 11),
    ('Biology Fundamentals', 'pH 7 is considered?', 12),
    ('Biology Fundamentals', 'Osmosis is the movement of?', 13),
    ('Biology Fundamentals', 'Which organ filters blood and produces urine?', 14),
    ('Shakespeare Study Guide', 'Who wrote Romeo and Juliet?', 0),
    ('Shakespeare Study Guide', 'Who wrote Macbeth?', 1),
    ('Shakespeare Study Guide', 'A naming word for a person, place, or thing is a?', 2),
    ('Shakespeare Study Guide', 'Hamlet is a?', 3),
    ('Shakespeare Study Guide', 'The main idea of a paragraph is often in the?', 4),
    ('Shakespeare Study Guide', 'A comparison using "like" or "as" is?', 5),
    ('Shakespeare Study Guide', 'Choose the correct plural: child → ?', 6),
    ('Shakespeare Study Guide', 'Which poetry form has 14 lines?', 7),
    ('Shakespeare Study Guide', 'The attitude of a narrator toward the subject is?', 8),
    ('Shakespeare Study Guide', 'Who wrote "Paradise Lost"?', 9),
    ('Shakespeare Study Guide', 'A statement that presents the opposite of truth for effect is?', 10),
    ('Shakespeare Study Guide', 'Past tense of "go"?', 11),
    ('Shakespeare Study Guide', 'Juliet appears in which play?', 12),
    ('Shakespeare Study Guide', 'Skimming is useful for?', 13),
    ('Shakespeare Study Guide', 'Beowulf is an example of?', 14),
    ('Shakespeare Study Guide', 'Which is a compound sentence?', 15),
    ('Shakespeare Study Guide', 'Dear Sir/Madam closes are common in?', 16),
    ('Shakespeare Study Guide', 'Prose is?', 17),
    ('Shakespeare Study Guide', 'Context clues help the reader?', 18),
    ('Shakespeare Study Guide', 'Which period is William Wordsworth linked to?', 19)
) AS v(set_title, qtext, sort_order)
INNER JOIN LATERAL (
  SELECT p.id, p.subject FROM practice_sets p WHERE p.title = v.set_title ORDER BY p.id LIMIT 1
) ps ON true
INNER JOIN LATERAL (
  SELECT q2.id FROM questions q2
  WHERE q2.question_text = v.qtext AND q2.subject = ps.subject
  ORDER BY q2.id LIMIT 1
) q ON true
ON CONFLICT DO NOTHING;

-- Insert sample study notes
INSERT INTO study_notes (title, subject, topic, form_level, content, word_count, status, author) VALUES
('Algebraic Expressions', 'Mathematics', 'Algebra', 'Form 4', 'This study note covers the basics of algebraic expressions...', 500, 'active', (SELECT id FROM users WHERE email = 'teacher@myspm.com')),
('Cell Structure and Function', 'Science', 'Biology', 'Form 4', 'Cells are the basic unit of life. There are two main types...', 800, 'active', (SELECT id FROM users WHERE email = 'teacher@myspm.com')),
('Shakespearean Sonnets', 'English', 'Literature', 'Form 5', 'Shakespeare wrote 154 sonnets during his lifetime...', 1200, 'draft', (SELECT id FROM users WHERE email = 'teacher@myspm.com'))
ON CONFLICT DO NOTHING;

-- Insert sample teacher posts
INSERT INTO teacher_posts (title, excerpt, content, category, audience, pinned, status, author) VALUES
('Welcome to MySPM', 'Welcome to our new online learning platform!', 'Dear students and parents, welcome to MySPM...', 'announcement', 'All Forms', true, 'active', (SELECT id FROM users WHERE email = 'teacher@myspm.com')),
('SPM Exam Tips', 'Here are some useful tips for the upcoming SPM exam', 'Time management is crucial during SPM exams...', 'tips', 'Form 5', false, 'active', (SELECT id FROM users WHERE email = 'teacher@myspm.com')),
('Holiday Assignment Posted', 'New holiday assignments are now available', 'Please complete the holiday assignments by July 31st...', 'assignment', 'All Forms', false, 'draft', (SELECT id FROM users WHERE email = 'teacher@myspm.com'))
ON CONFLICT DO NOTHING;

-- Insert sample student results
INSERT INTO student_results (student_id, exam_id, score, total_marks, status, attempt_date) VALUES
((SELECT id FROM users WHERE email = 'ali@myspm.com'), (SELECT id FROM exams WHERE title = 'Form 4 Mathematics Mid-Term'), 75.5, 100, 'completed', NOW() - INTERVAL '2 days'),
((SELECT id FROM users WHERE email = 'jane@myspm.com'), (SELECT id FROM exams WHERE title = 'Form 4 Mathematics Mid-Term'), 82.0, 100, 'completed', NOW() - INTERVAL '1 day'),
((SELECT id FROM users WHERE email = 'fatima@myspm.com'), (SELECT id FROM exams WHERE title = 'SPM Biology Practice Test'), 88.5, 100, 'completed', NOW()),
((SELECT id FROM users WHERE email = 'ali@myspm.com'), (SELECT id FROM exams WHERE title = 'SPM Biology Practice Test'), 72.0, 100, 'completed', NOW() - INTERVAL '3 hours')
ON CONFLICT DO NOTHING;

-- Insert sample attempt answers
INSERT INTO attempt_answers (result_id, question_id, student_answer, is_correct, marks, feedback) VALUES
((SELECT id FROM student_results WHERE student_id = (SELECT id FROM users WHERE email = 'ali@myspm.com') LIMIT 1), (SELECT id FROM questions WHERE question_text = 'What is 2 + 2?' LIMIT 1), '1', true, 1.0, 'Correct!'),
((SELECT id FROM student_results WHERE student_id = (SELECT id FROM users WHERE email = 'ali@myspm.com') LIMIT 1), (SELECT id FROM questions WHERE question_text = 'Solve for x: 2x + 3 = 7' LIMIT 1), '1', true, 1.0, 'Correct solution!'),
((SELECT id FROM student_results WHERE student_id = (SELECT id FROM users WHERE email = 'jane@myspm.com') LIMIT 1), (SELECT id FROM questions WHERE question_text = 'What is 2 + 2?' LIMIT 1), '1', true, 1.0, 'Correct!')
ON CONFLICT DO NOTHING;