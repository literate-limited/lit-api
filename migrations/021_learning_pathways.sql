-- Migration 021: Learning Pathways System
-- Purpose: Create structured learning journeys with multi-step sequences, progress tracking, and recommendations

-- ============================================================================
-- Main Pathway Definition Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS learning_pathways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- Pathway identity
  code TEXT NOT NULL,  -- e.g., 'law-crim-mastery', stable identifier
  title TEXT NOT NULL,
  description TEXT,

  -- Pathway classification
  pathway_type TEXT NOT NULL DEFAULT 'core'
    CHECK (pathway_type IN ('core', 'supplemental', 'remedial', 'advanced', 'certification')),

  target_proficiency TEXT NOT NULL DEFAULT 'intermediate'
    CHECK (target_proficiency IN ('beginner', 'intermediate', 'advanced', 'expert', 'mixed')),

  -- Content scope
  topic_ids TEXT[] DEFAULT '{}'::TEXT[],  -- Topics covered
  app_code TEXT NOT NULL,  -- e.g., 'law', 'lit', 'mat'

  -- Prerequisites and sequencing
  prerequisite_pathway_ids UUID[] DEFAULT '{}'::UUID[],
  is_sequential BOOLEAN DEFAULT TRUE,  -- Must complete in order?

  -- Auto-recommendation configuration
  recommended_for_gaps TEXT[] DEFAULT '{}'::TEXT[],  -- Competency gaps triggering recommendation
  tags TEXT[] DEFAULT '{}'::TEXT[],  -- For filtering/discovery

  -- Metadata
  estimated_hours NUMERIC(5, 1),  -- Expected completion time
  difficulty_level TEXT
    CHECK (difficulty_level IS NULL OR difficulty_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Status and timestamps
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (brand_id, app_code, code)
);

CREATE INDEX IF NOT EXISTS idx_learning_pathways_brand_app
  ON learning_pathways(brand_id, app_code);

CREATE INDEX IF NOT EXISTS idx_learning_pathways_pathway_type
  ON learning_pathways(pathway_type);

CREATE INDEX IF NOT EXISTS idx_learning_pathways_topic_ids
  ON learning_pathways USING GIN(topic_ids);

CREATE INDEX IF NOT EXISTS idx_learning_pathways_tags
  ON learning_pathways USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_learning_pathways_recommended_for_gaps
  ON learning_pathways USING GIN(recommended_for_gaps);

CREATE INDEX IF NOT EXISTS idx_learning_pathways_active
  ON learning_pathways(is_active)
  WHERE is_active = TRUE;

-- ============================================================================
-- Pathway Steps (Sequence of content items)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pathway_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pathway_id UUID NOT NULL REFERENCES learning_pathways(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- Step position and type
  step_order INTEGER NOT NULL,  -- 1, 2, 3, ...
  step_type TEXT NOT NULL
    CHECK (step_type IN ('lesson', 'unit', 'assessment', 'practice', 'project', 'milestone')),

  -- Polymorphic content references (exactly one must be set)
  level_id UUID REFERENCES level(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES unit(id) ON DELETE CASCADE,
  unit_assessment_id UUID REFERENCES unit_assessments(id) ON DELETE CASCADE,

  -- Step configuration
  prerequisite_step_ids UUID[] DEFAULT '{}'::UUID[],  -- Within-pathway dependencies
  is_required BOOLEAN DEFAULT TRUE,  -- Can be skipped?
  estimated_minutes INTEGER,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure exactly one content reference
  CHECK (
    (level_id IS NOT NULL AND unit_id IS NULL AND unit_assessment_id IS NULL) OR
    (level_id IS NULL AND unit_id IS NOT NULL AND unit_assessment_id IS NULL) OR
    (level_id IS NULL AND unit_id IS NULL AND unit_assessment_id IS NOT NULL)
  ),

  UNIQUE (pathway_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_pathway_steps_pathway
  ON pathway_steps(pathway_id, step_order);

CREATE INDEX IF NOT EXISTS idx_pathway_steps_level
  ON pathway_steps(level_id);

CREATE INDEX IF NOT EXISTS idx_pathway_steps_unit
  ON pathway_steps(unit_id);

CREATE INDEX IF NOT EXISTS idx_pathway_steps_unit_assessment
  ON pathway_steps(unit_assessment_id);

CREATE INDEX IF NOT EXISTS idx_pathway_steps_prerequisite
  ON pathway_steps USING GIN(prerequisite_step_ids);

-- ============================================================================
-- Student Pathway Enrollment & Progress
-- ============================================================================
CREATE TABLE IF NOT EXISTS student_pathway_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pathway_id UUID NOT NULL REFERENCES learning_pathways(id) ON DELETE CASCADE,

  -- Enrollment metadata
  enrollment_type TEXT NOT NULL DEFAULT 'self_enrolled'
    CHECK (enrollment_type IN ('self_enrolled', 'teacher_assigned', 'recommended', 'required')),
  teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Progress state
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'abandoned')),

  -- Current position
  current_step_id UUID REFERENCES pathway_steps(id) ON DELETE SET NULL,
  current_step_order INTEGER,

  -- Denormalized counters (updated via triggers)
  total_steps INTEGER NOT NULL DEFAULT 0,
  required_steps_completed INTEGER DEFAULT 0,
  steps_completed INTEGER DEFAULT 0,

  -- Performance metrics
  average_score NUMERIC(5, 2),  -- Across all assessment steps
  attempts INTEGER DEFAULT 0,

  -- Timeline
  expected_completion_date TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, pathway_id)
);

CREATE INDEX IF NOT EXISTS idx_student_pathway_progress_user
  ON student_pathway_progress(user_id);

CREATE INDEX IF NOT EXISTS idx_student_pathway_progress_pathway
  ON student_pathway_progress(pathway_id);

CREATE INDEX IF NOT EXISTS idx_student_pathway_progress_user_status
  ON student_pathway_progress(user_id, status);

CREATE INDEX IF NOT EXISTS idx_student_pathway_progress_current_step
  ON student_pathway_progress(current_step_id);

CREATE INDEX IF NOT EXISTS idx_student_pathway_progress_activity
  ON student_pathway_progress(user_id, last_activity_at);

-- ============================================================================
-- Individual Step Progress (Granular tracking per step)
-- ============================================================================
CREATE TABLE IF NOT EXISTS student_step_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pathway_id UUID NOT NULL REFERENCES learning_pathways(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES pathway_steps(id) ON DELETE CASCADE,

  -- Step completion status
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped')),

  -- Assessment-specific fields
  score NUMERIC(5, 2),  -- 0-100 for assessment steps
  passed BOOLEAN,  -- Did they pass threshold?
  attempts INTEGER DEFAULT 0,

  -- Time tracking
  time_spent_seconds INTEGER DEFAULT 0,

  -- Timeline
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, pathway_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_student_step_progress_user
  ON student_step_progress(user_id);

CREATE INDEX IF NOT EXISTS idx_student_step_progress_pathway
  ON student_step_progress(pathway_id);

CREATE INDEX IF NOT EXISTS idx_student_step_progress_step
  ON student_step_progress(step_id);

CREATE INDEX IF NOT EXISTS idx_student_step_progress_user_pathway_status
  ON student_step_progress(user_id, pathway_id, status);

CREATE INDEX IF NOT EXISTS idx_student_step_progress_completed
  ON student_step_progress(completed_at)
  WHERE completed_at IS NOT NULL;

-- ============================================================================
-- Pathway Recommendations
-- ============================================================================
CREATE TABLE IF NOT EXISTS pathway_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pathway_id UUID NOT NULL REFERENCES learning_pathways(id) ON DELETE CASCADE,

  -- Recommendation reasoning
  reason TEXT NOT NULL
    CHECK (reason IN ('competency_gap', 'prerequisite_completed', 'similar_pathway', 'teacher_recommended', 'performance_trend')),

  confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.5
    CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- Supporting data
  based_on_competency_gaps TEXT[] DEFAULT '{}'::TEXT[],
  based_on_mastery JSONB DEFAULT '{}'::jsonb,

  -- Status and timeline
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'viewed', 'enrolled', 'dismissed')),

  viewed_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recommended_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pathway_recommendations_user
  ON pathway_recommendations(user_id, status);

CREATE INDEX IF NOT EXISTS idx_pathway_recommendations_pathway
  ON pathway_recommendations(pathway_id);

CREATE INDEX IF NOT EXISTS idx_pathway_recommendations_pending
  ON pathway_recommendations(user_id, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pathway_recommendations_expires
  ON pathway_recommendations(expires_at);

-- ============================================================================
-- Helper Views
-- ============================================================================

-- Pathway Progress Summary (Class-wide statistics)
CREATE OR REPLACE VIEW pathway_progress_summary AS
SELECT
  p.id AS pathway_id,
  p.brand_id,
  p.code,
  p.title,
  p.app_code,
  COUNT(DISTINCT spp.user_id) AS enrolled_students,
  COUNT(DISTINCT CASE WHEN spp.status = 'completed' THEN spp.user_id END) AS completed_students,
  ROUND(
    COUNT(DISTINCT CASE WHEN spp.status = 'completed' THEN spp.user_id END)::NUMERIC /
    NULLIF(COUNT(DISTINCT spp.user_id), 0) * 100,
    2
  ) AS completion_rate_pct,
  ROUND(AVG(spp.average_score), 2) AS avg_score,
  ROUND(AVG(EXTRACT(EPOCH FROM (spp.completed_at - spp.started_at))), 0) AS avg_duration_seconds
FROM learning_pathways p
LEFT JOIN student_pathway_progress spp ON spp.pathway_id = p.id
WHERE p.is_active = TRUE
GROUP BY p.id, p.brand_id, p.code, p.title, p.app_code;

-- Student Pathway Dashboard (Student view of their pathways)
CREATE OR REPLACE VIEW student_pathway_dashboard AS
SELECT
  spp.id,
  spp.user_id,
  spp.pathway_id,
  p.code AS pathway_code,
  p.title AS pathway_title,
  p.app_code,
  spp.status,
  spp.current_step_order,
  ps.step_type AS current_step_type,
  ROUND(
    (spp.steps_completed::NUMERIC / NULLIF(spp.total_steps, 0)) * 100,
    2
  ) AS progress_percentage,
  spp.average_score,
  spp.expected_completion_date,
  spp.last_activity_at,
  spp.created_at,
  spp.updated_at
FROM student_pathway_progress spp
JOIN learning_pathways p ON p.id = spp.pathway_id
LEFT JOIN pathway_steps ps ON ps.id = spp.current_step_id
WHERE p.is_active = TRUE;

-- ============================================================================
-- Triggers for Timestamp Updates
-- ============================================================================
CREATE OR REPLACE FUNCTION update_pathway_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS learning_pathways_timestamp ON learning_pathways;
CREATE TRIGGER learning_pathways_timestamp
BEFORE UPDATE ON learning_pathways
FOR EACH ROW
EXECUTE FUNCTION update_pathway_timestamp();

DROP TRIGGER IF EXISTS pathway_steps_timestamp ON pathway_steps;
CREATE TRIGGER pathway_steps_timestamp
BEFORE UPDATE ON pathway_steps
FOR EACH ROW
EXECUTE FUNCTION update_pathway_timestamp();

DROP TRIGGER IF EXISTS student_pathway_progress_timestamp ON student_pathway_progress;
CREATE TRIGGER student_pathway_progress_timestamp
BEFORE UPDATE ON student_pathway_progress
FOR EACH ROW
EXECUTE FUNCTION update_pathway_timestamp();

DROP TRIGGER IF EXISTS student_step_progress_timestamp ON student_step_progress;
CREATE TRIGGER student_step_progress_timestamp
BEFORE UPDATE ON student_step_progress
FOR EACH ROW
EXECUTE FUNCTION update_pathway_timestamp();

-- ============================================================================
-- Trigger: Update pathway denormalized counters when step progress changes
-- ============================================================================
CREATE OR REPLACE FUNCTION update_pathway_counters()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE student_pathway_progress
  SET
    steps_completed = (
      SELECT COUNT(*) FROM student_step_progress
      WHERE pathway_id = NEW.pathway_id
        AND user_id = NEW.user_id
        AND status = 'completed'
    ),
    required_steps_completed = (
      SELECT COUNT(*) FROM student_step_progress ssp
      JOIN pathway_steps ps ON ps.id = ssp.step_id
      WHERE ssp.pathway_id = NEW.pathway_id
        AND ssp.user_id = NEW.user_id
        AND ssp.status = 'completed'
        AND ps.is_required = TRUE
    ),
    average_score = (
      SELECT AVG(score) FROM student_step_progress
      WHERE pathway_id = NEW.pathway_id
        AND user_id = NEW.user_id
        AND score IS NOT NULL
    ),
    updated_at = NOW()
  WHERE pathway_id = NEW.pathway_id
    AND user_id = NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_pathway_counters_trigger ON student_step_progress;
CREATE TRIGGER update_pathway_counters_trigger
AFTER INSERT OR UPDATE ON student_step_progress
FOR EACH ROW
EXECUTE FUNCTION update_pathway_counters();

-- ============================================================================
-- Seed: Sample Law Pathways
-- ============================================================================
DO $$
DECLARE
  law_brand_id UUID;
  pathway_id UUID;
BEGIN
  -- Get law brand
  SELECT id INTO law_brand_id FROM brands WHERE code = 'law' LIMIT 1;

  IF law_brand_id IS NOT NULL THEN
    -- Criminal Law Foundations pathway
    INSERT INTO learning_pathways
      (brand_id, code, title, description, pathway_type, target_proficiency, app_code,
       topic_ids, difficulty_level, estimated_hours, is_sequential)
    VALUES
      (law_brand_id, 'law-crim-foundations', 'Criminal Law Foundations',
       'Master the foundational concepts of criminal law including actus reus, mens rea, and common defenses.',
       'core', 'beginner', 'law',
       ARRAY['law:criminal'], 'beginner', 8.5, TRUE)
    ON CONFLICT (brand_id, app_code, code) DO NOTHING;

    -- Constitutional Law Track pathway
    INSERT INTO learning_pathways
      (brand_id, code, title, description, pathway_type, target_proficiency, app_code,
       topic_ids, difficulty_level, estimated_hours, is_sequential)
    VALUES
      (law_brand_id, 'law-const-track', 'Constitutional Law Track',
       'Explore constitutional structure, fundamental rights, and due process principles.',
       'core', 'intermediate', 'law',
       ARRAY['law:constitutional'], 'intermediate', 12.0, TRUE)
    ON CONFLICT (brand_id, app_code, code) DO NOTHING;

    -- Evidence Mastery pathway
    INSERT INTO learning_pathways
      (brand_id, code, title, description, pathway_type, target_proficiency, app_code,
       topic_ids, difficulty_level, estimated_hours, is_sequential, is_active)
    VALUES
      (law_brand_id, 'law-evidence-mastery', 'Evidence Mastery',
       'Achieve advanced proficiency in evidence law including admissibility, hearsay, and expert testimony.',
       'advanced', 'advanced', 'law',
       ARRAY['law:evidence'], 'advanced', 15.0, TRUE, TRUE)
    ON CONFLICT (brand_id, app_code, code) DO NOTHING;

  END IF;
END $$;
