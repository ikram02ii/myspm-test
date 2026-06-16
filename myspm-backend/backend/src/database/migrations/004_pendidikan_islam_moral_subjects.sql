-- Onboarding / profile favourites: Pendidikan Islam & Pendidikan Moral
INSERT INTO lov_values (category_id, code, display_name_en, display_name_ms, sort_order, status)
SELECT lc.id, 'pisislam', 'Pendidikan Islam', 'Pendidikan Islam', 95, 'active'
FROM lov_categories lc
WHERE lc.code = 'subjects'
  AND NOT EXISTS (
    SELECT 1 FROM lov_values lv
    WHERE lv.category_id = lc.id AND lv.code = 'pisislam'
  );

INSERT INTO lov_values (category_id, code, display_name_en, display_name_ms, sort_order, status)
SELECT lc.id, 'pismoral', 'Pendidikan Moral', 'Pendidikan Moral', 96, 'active'
FROM lov_categories lc
WHERE lc.code = 'subjects'
  AND NOT EXISTS (
    SELECT 1 FROM lov_values lv
    WHERE lv.category_id = lc.id AND lv.code = 'pismoral'
  );
