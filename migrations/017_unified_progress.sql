-- Migration 017: Unified Student Progress System
-- Consolidates progress tracking across all apps (LIT, Law, Deb, TTV, etc.)
-- Single source of truth for student learning journey

-- ============================================================================
-- Unified Progress Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS unified_student_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,

  -- What app and content
  app_code TEXT NOT NULL, -- 'lit', 'law', 'deb', 'ttv', 'mat', 'signsymposium'
  topic_id TEXT NOT NULL, -- e.g., 'law:criminal', 'lit:french:conjugation'
  unit_id UUID,  -- Can be NULL for self-paced learning without formal units
  level_id UUID,  -- Can be NULL for self-paced learning

  -- Progress state
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'struggling', 'mastered')),

  -- Performance metrics
  score NUMERIC(5, 2), -- 0-100 percentage
  time_spent_seconds INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Metadata (app-specific data)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint: one progress record per student/unit/app
  UNIQUE (user_id, app_code, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_unified_progress_user_class
  ON unified_student_progress(user_id, class_id, app_code);

CREATE INDEX IF NOT EXISTS idx_unified_progress_class
  ON unified_student_progress(class_id, app_code);

CREATE INDEX IF NOT EXISTS idx_unified_progress_unit
  ON unified_student_progress(unit_id, status);

CREATE INDEX IF NOT EXISTS idx_unified_progress_updated
  ON unified_student_progress(user_id, updated_at DESC);

-- ============================================================================
-- Class Assignments Table (What teachers assign to students)
-- ============================================================================
CREATE TABLE IF NOT EXISTS class_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,

  -- What to assign
  app_code TEXT NOT NULL, -- 'law', 'deb', 'lit', etc.
  unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE CASCADE,

  -- When
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date TIMESTAMPTZ,

  -- Assignment metadata
  description TEXT,
  required BOOLEAN DEFAULT FALSE, -- If false, optional challenge
  points INTEGER DEFAULT 100,

  created_by UUID NOT NULL REFERENCES users(id), -- Teacher who assigned
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_assignments_class
  ON class_assignments(class_id, app_code);

CREATE INDEX IF NOT EXISTS idx_class_assignments_due
  ON class_assignments(due_date DESC NULLS LAST);

-- ============================================================================
-- Teacher Preferences (Dashboard customization per teacher)
-- ============================================================================
CREATE TABLE IF NOT EXISTS teacher_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Dashboard layout
  dashboard_layout TEXT DEFAULT 'grid', -- 'grid', 'list', 'kanban'
  default_view TEXT DEFAULT 'progress', -- 'progress', 'analytics', 'assignments'

  -- Widget preferences
  widgets JSONB DEFAULT '{"progress": true, "analytics": true, "assignments": true, "alerts": true}'::jsonb,

  -- Grouping preference
  class_grouping TEXT DEFAULT 'by_class', -- 'by_class', 'by_app', 'by_student'

  -- Notification settings
  notify_struggling_students BOOLEAN DEFAULT TRUE,
  notify_completed_assignments BOOLEAN DEFAULT TRUE,
  notify_quiz_submissions BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Learning Recommendations (AI-generated suggestions for students)
-- ============================================================================
CREATE TABLE IF NOT EXISTS learning_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Recommendation
  app_code TEXT NOT NULL, -- What app to try
  unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL, -- For context

  -- Why recommend
  reason TEXT NOT NULL, -- 'skill_match', 'prerequisite_completed', 'struggling_in', 'related_to_strength'
  confidence NUMERIC(3, 2) DEFAULT 0.8, -- 0.0-1.0

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'viewed', 'started', 'dismissed')),
  dismissed_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_recommendations_user
  ON learning_recommendations(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendations_expires
  ON learning_recommendations(expires_at);

-- ============================================================================
-- Student Mastery Tracking (Aggregate skill mastery)
-- ============================================================================
CREATE TABLE IF NOT EXISTS student_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Skill/topic being tracked
  app_code TEXT NOT NULL,
  skill_id TEXT NOT NULL, -- e.g., 'law:criminal:actus_reus' or 'lit:french:subjunctive'
  skill_name TEXT NOT NULL,

  -- Mastery level
  mastery_level INTEGER DEFAULT 0 CHECK (mastery_level BETWEEN 0 AND 100), -- 0-100
  proficiency TEXT DEFAULT 'beginner'
    CHECK (proficiency IN ('beginner', 'intermediate', 'advanced', 'expert')),

  -- Tracking
  units_completed INTEGER DEFAULT 0,
  total_units INTEGER DEFAULT 0,
  last_practiced_at TIMESTAMPTZ,
  last_assessed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, app_code, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_student_mastery_user
  ON student_mastery(user_id, app_code);

-- ============================================================================
-- Progress Sync Log (Track when apps sync progress)
-- ============================================================================
CREATE TABLE IF NOT EXISTS progress_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_code TEXT NOT NULL,
  sync_type TEXT NOT NULL, -- 'law', 'lit', 'deb', etc.

  records_synced INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed')),
  error_message TEXT,

  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progress_sync_log_app
  ON progress_sync_log(app_code, synced_at DESC);

-- ============================================================================
-- Trigger: Auto-update timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION update_unified_progress_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop triggers if they exist (since CREATE TRIGGER IF NOT EXISTS doesn't exist)
DROP TRIGGER IF EXISTS unified_progress_timestamp ON unified_student_progress;
DROP TRIGGER IF EXISTS teacher_preferences_timestamp ON teacher_preferences;
DROP TRIGGER IF EXISTS student_mastery_timestamp ON student_mastery;

-- Create triggers
CREATE TRIGGER unified_progress_timestamp
BEFORE UPDATE ON unified_student_progress
FOR EACH ROW
EXECUTE FUNCTION update_unified_progress_timestamp();

CREATE TRIGGER teacher_preferences_timestamp
BEFORE UPDATE ON teacher_preferences
FOR EACH ROW
EXECUTE FUNCTION update_unified_progress_timestamp();

CREATE TRIGGER student_mastery_timestamp
BEFORE UPDATE ON student_mastery
FOR EACH ROW
EXECUTE FUNCTION update_unified_progress_timestamp();

-- ============================================================================
-- Sample Data (For testing)
-- ============================================================================
-- Note: These are optional and used for development/testing only
-- DO $$
-- BEGIN
--   INSERT INTO unified_student_progress (brand_id, user_id, app_code, topic_id, status)
--   SELECT
--     b.id,
--     u.id,
--     'law',
--     'law:criminal',
--     'in_progress'
--   FROM brands b, users u
--   WHERE b.code = 'law' AND u.role = 'student'
--   LIMIT 1
--   ON CONFLICT DO NOTHING;
-- END $$;
