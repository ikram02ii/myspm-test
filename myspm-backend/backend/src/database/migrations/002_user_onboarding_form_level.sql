-- Student onboarding: form level as integer (4 or 5).
ALTER TABLE users ADD COLUMN IF NOT EXISTS form_level INTEGER;
