-- Setup script for Scythe Science Brand
-- Run this ONCE to initialize Scythe Science in the system

-- ============================================================================
-- 1. Create Scythe Science Brand
-- ============================================================================
INSERT INTO brands (code, name, created_at)
VALUES ('scythe_science', 'Scythe Science', NOW())
ON CONFLICT (code) DO NOTHING;

-- Get the brand ID for use below
DO $$
DECLARE
  sci_brand_id UUID;
BEGIN
  SELECT id INTO sci_brand_id FROM brands WHERE code = 'scythe_science' LIMIT 1;

  IF sci_brand_id IS NULL THEN
    RAISE EXCEPTION 'Scythe Science brand could not be created or found';
  END IF;

  -- ============================================================================
  -- 2. Create Science App Configuration
  -- ============================================================================
  -- (This would typically be in an app_config table or similar - optional)

  -- ============================================================================
  -- 3. Create Sample Topics for Science
  -- ============================================================================
  INSERT INTO topic (id, app_code, code, name, description, created_at)
  VALUES
    ('sci:phys:motion', 'scythe_science', 'science:physics:motion', 'Motion & Forces', 'Study of motion and forces', NOW()),
    ('sci:phys:energy', 'scythe_science', 'science:physics:energy', 'Energy', 'Energy forms and transfer', NOW()),
    ('sci:chem:reactions', 'scythe_science', 'science:chemistry:reactions', 'Chemical Reactions', 'Chemical reactions and bonding', NOW()),
    ('sci:bio:cells', 'scythe_science', 'science:biology:cells', 'Cells & Life', 'Cell structure and life processes', NOW()),
    ('sci:bio:ecology', 'scythe_science', 'science:biology:ecology', 'Ecology', 'Ecosystems and biodiversity', NOW()),
    ('sci:earth:rocks', 'scythe_science', 'science:earth:rocks', 'Rocks & Minerals', 'Earth materials and geology', NOW()),
    ('sci:earth:weather', 'scythe_science', 'science:earth:weather', 'Weather & Climate', 'Atmosphere and climate systems', NOW()),
    ('sci:space:cosmos', 'scythe_science', 'science:space:cosmos', 'Space', 'Solar system and cosmos', NOW())
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 4. Verify ACARA Indicators Are Present
  -- ============================================================================
  RAISE NOTICE 'Scythe Science Setup Complete!';
  RAISE NOTICE 'Brand ID: %', sci_brand_id;
  RAISE NOTICE 'ACARA Indicators: % total',
    (SELECT COUNT(*) FROM learning_spine_indicator WHERE brand_id = sci_brand_id);
  RAISE NOTICE 'Topics Created: %',
    (SELECT COUNT(*) FROM topic WHERE app_code = 'scythe_science');

END $$;

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check brand was created
SELECT 'Brand' as item, code, name FROM brands WHERE code = 'scythe_science';

-- Check indicators are available
SELECT
  'Indicators' as item,
  app_code,
  COUNT(*) as total,
  COUNT(DISTINCT subject_area) as strands
FROM learning_spine_indicator
WHERE app_code = 'scythe_science'
GROUP BY app_code;

-- Check topics were created
SELECT
  'Topics' as item,
  app_code,
  COUNT(*) as total
FROM topic
WHERE app_code = 'scythe_science'
GROUP BY app_code;

-- Sample of available indicators
SELECT
  'Sample Indicators' as item,
  indicator_code,
  title,
  level_band,
  cognitive_level
FROM learning_spine_indicator
WHERE app_code = 'scythe_science'
LIMIT 10;
