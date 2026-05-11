-- If form_level was created as VARCHAR, convert to INTEGER (4 or 5).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'form_level'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE users
      ALTER COLUMN form_level TYPE INTEGER
      USING (
        CASE TRIM(form_level::text)
          WHEN 'Form 4' THEN 4
          WHEN 'Form 5' THEN 5
          WHEN '4' THEN 4
          WHEN '5' THEN 5
          ELSE NULL
        END
      );
  END IF;
END $$;
