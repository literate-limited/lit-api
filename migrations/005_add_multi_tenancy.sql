-- Migration 005: Add Multi-Tenancy Support
-- This migration adds brand-based multi-tenancy to the entire database

-- ============================================================================
-- 1. Create brands table
-- ============================================================================
CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  origins JSONB NOT NULL DEFAULT '[]'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial brands
INSERT INTO brands (code, name, origins, data) VALUES
  (
    'lit',
    'LIT Lang',
    '["http://localhost:5173", "https://lit-mvp.vercel.app", "https://lit-mvp-*.vercel.app"]'::jsonb,
    '{
      "theme": "lit",
      "logo": "/lit-logo.svg",
      "primaryColor": "#4F46E5",
      "description": "Language Immersion Technology"
    }'::jsonb
  ),
  (
    'ttv',
    'TeleprompTV',
    '["http://localhost:1313", "https://teleprompttv.tv", "https://www.teleprompttv.tv", "https://teleprompttv-*.vercel.app"]'::jsonb,
    '{
      "theme": "ttv",
      "logo": "/ttv-logo.svg",
      "primaryColor": "#10B981",
      "description": "AI-Powered Video Production Platform"
    }'::jsonb
  )
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_brands_code ON brands(code);

-- ============================================================================
-- 2. Add brand_id column to all tables
-- ============================================================================

-- Core tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;

-- Message tables
ALTER TABLE message ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE message_segment ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE message_analysis ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE ai_response ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;

-- Curriculum tables
ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE topic ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE question ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE topic_hierarchy ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;

-- Adaptive learning tables
ALTER TABLE unit ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE level ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE level_progress ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE unit_assignment ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE student_assessment ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;

-- ============================================================================
-- 3. Backfill existing data with 'lit' brand
-- ============================================================================

DO $$
DECLARE
  lit_brand_id UUID;
BEGIN
  -- Get the 'lit' brand ID
  SELECT id INTO lit_brand_id FROM brands WHERE code = 'lit';

  IF lit_brand_id IS NULL THEN
    RAISE EXCEPTION 'LIT brand not found. Cannot backfill data.';
  END IF;

  -- Backfill all tables
  UPDATE users SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE classes SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE enrollments SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE chat_rooms SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE message SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE message_segment SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE message_analysis SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE ai_response SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE curriculum_statements SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE topic SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE question SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE topic_hierarchy SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE unit SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE level SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE level_progress SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE unit_assignment SET brand_id = lit_brand_id WHERE brand_id IS NULL;
  UPDATE student_assessment SET brand_id = lit_brand_id WHERE brand_id IS NULL;

  RAISE NOTICE 'Successfully backfilled all tables with LIT brand';
END $$;

-- ============================================================================
-- 4. Make brand_id NOT NULL
-- ============================================================================

ALTER TABLE users ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE classes ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE enrollments ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE chat_rooms ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE message ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE message_segment ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE message_analysis ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE ai_response ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE curriculum_statements ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE topic ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE question ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE topic_hierarchy ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE unit ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE level ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE level_progress ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE unit_assignment ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE student_assessment ALTER COLUMN brand_id SET NOT NULL;

-- ============================================================================
-- 5. Create indexes for brand_id on all tables
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_brand ON users(brand_id);
CREATE INDEX IF NOT EXISTS idx_classes_brand ON classes(brand_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_brand ON enrollments(brand_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_brand ON chat_rooms(brand_id);
CREATE INDEX IF NOT EXISTS idx_message_brand ON message(brand_id);
CREATE INDEX IF NOT EXISTS idx_message_segment_brand ON message_segment(brand_id);
CREATE INDEX IF NOT EXISTS idx_message_analysis_brand ON message_analysis(brand_id);
CREATE INDEX IF NOT EXISTS idx_ai_response_brand ON ai_response(brand_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_statements_brand ON curriculum_statements(brand_id);
CREATE INDEX IF NOT EXISTS idx_topic_brand ON topic(brand_id);
CREATE INDEX IF NOT EXISTS idx_question_brand ON question(brand_id);
CREATE INDEX IF NOT EXISTS idx_topic_hierarchy_brand ON topic_hierarchy(brand_id);
CREATE INDEX IF NOT EXISTS idx_unit_brand ON unit(brand_id);
CREATE INDEX IF NOT EXISTS idx_level_brand ON level(brand_id);
CREATE INDEX IF NOT EXISTS idx_level_progress_brand ON level_progress(brand_id);
CREATE INDEX IF NOT EXISTS idx_unit_assignment_brand ON unit_assignment(brand_id);
CREATE INDEX IF NOT EXISTS idx_student_assessment_brand ON student_assessment(brand_id);

-- ============================================================================
-- 6. Update unique constraints to include brand_id where needed
-- ============================================================================

-- Users: email should be unique per brand
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_brand_unique ON users(email, brand_id);

-- Classes: code should be unique per brand
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_code_brand_unique ON classes(code, brand_id);

-- Student assessment: user + language should be unique per brand
ALTER TABLE student_assessment DROP CONSTRAINT IF EXISTS student_assessment_user_id_language_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_assessment_unique ON student_assessment(user_id, language, brand_id);

-- Unit assignment: user + unit should be unique per brand
ALTER TABLE unit_assignment DROP CONSTRAINT IF EXISTS unit_assignment_user_id_unit_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_assignment_unique ON unit_assignment(user_id, unit_id, brand_id);

-- Level progress: user + level + attempt should be unique per brand
ALTER TABLE level_progress DROP CONSTRAINT IF EXISTS level_progress_user_id_level_id_attempt_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_level_progress_unique ON level_progress(user_id, level_id, attempt_number, brand_id);
