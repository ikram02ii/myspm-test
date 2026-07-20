-- Onboarding / profile favourites: Perniagaan, Prinsip Perakaunan, Ekonomi, Geografi
INSERT INTO lov_values (category_id, code, display_name_en, display_name_ms, sort_order, status)
SELECT lc.id, 'perniagaan', 'Perniagaan', 'Perniagaan', 97, 'active'
FROM lov_categories lc
WHERE lc.code = 'subjects'
  AND NOT EXISTS (
    SELECT 1 FROM lov_values lv
    WHERE lv.category_id = lc.id AND lv.code = 'perniagaan'
  );

INSERT INTO lov_values (category_id, code, display_name_en, display_name_ms, sort_order, status)
SELECT lc.id, 'akaun', 'Prinsip Perakaunan', 'Prinsip Perakaunan', 98, 'active'
FROM lov_categories lc
WHERE lc.code = 'subjects'
  AND NOT EXISTS (
    SELECT 1 FROM lov_values lv
    WHERE lv.category_id = lc.id AND lv.code = 'akaun'
  );

INSERT INTO lov_values (category_id, code, display_name_en, display_name_ms, sort_order, status)
SELECT lc.id, 'ekonomi', 'Ekonomi', 'Ekonomi', 99, 'active'
FROM lov_categories lc
WHERE lc.code = 'subjects'
  AND NOT EXISTS (
    SELECT 1 FROM lov_values lv
    WHERE lv.category_id = lc.id AND lv.code = 'ekonomi'
  );

INSERT INTO lov_values (category_id, code, display_name_en, display_name_ms, sort_order, status)
SELECT lc.id, 'geografi', 'Geografi', 'Geografi', 100, 'active'
FROM lov_categories lc
WHERE lc.code = 'subjects'
  AND NOT EXISTS (
    SELECT 1 FROM lov_values lv
    WHERE lv.category_id = lc.id AND lv.code = 'geografi'
  );
