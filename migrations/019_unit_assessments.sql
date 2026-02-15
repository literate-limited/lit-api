-- Migration 019: Unit Assessments
-- Adds comprehensive assessment system with multiple assessment types
-- Pre-test, formative, summative, and post-test assessments

-- ============================================================================
-- Unit Assessments Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS unit_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- Assessment Type
  assessment_type TEXT NOT NULL
    CHECK (assessment_type IN ('pre_test', 'formative', 'summative', 'post_test')),

  -- Sequencing
  sequence_order INTEGER NOT NULL DEFAULT 1
    CHECK (sequence_order > 0),

  -- Grading Requirements
  passing_score_required NUMERIC(3, 2) NOT NULL DEFAULT 0.70
    CHECK (passing_score_required >= 0 AND passing_score_required <= 1.0),

  -- Constraints
  time_limit_minutes INTEGER,
  show_answers_after_submit BOOLEAN DEFAULT TRUE,
  show_correct_answer_value BOOLEAN DEFAULT TRUE,
  randomize_questions BOOLEAN DEFAULT FALSE,
  randomize_options BOOLEAN DEFAULT FALSE,

  -- Configuration
  allow_multiple_attempts BOOLEAN DEFAULT TRUE,
  max_attempts INTEGER,
  required_to_progress BOOLEAN DEFAULT FALSE,

  -- Metadata
  description TEXT,
  instructions TEXT,
  feedback_template TEXT, -- Template for feedback messages

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (unit_id, assessment_type)
);

CREATE INDEX IF NOT EXISTS idx_unit_assessments_unit
  ON unit_assessments(unit_id, assessment_type);

CREATE INDEX IF NOT EXISTS idx_unit_assessments_sequence
  ON unit_assessments(unit_id, sequence_order);

CREATE INDEX IF NOT EXISTS idx_unit_assessments_active
  ON unit_assessments(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- Assessment Questions (Many-to-Many)
-- ============================================================================
CREATE TABLE IF NOT EXISTS assessment_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES unit_assessments(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,

  -- Ordering and Points
  sequence_order INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 1 CHECK (points > 0),

  -- Difficulty weighting (for adaptive scoring)
  difficulty_weight NUMERIC(3, 2) DEFAULT 1.0 CHECK (difficulty_weight > 0),

  -- Metadata
  explanation_override TEXT, -- Override default explanation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (assessment_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_questions_assessment
  ON assessment_questions(assessment_id, sequence_order);

CREATE INDEX IF NOT EXISTS idx_assessment_questions_question
  ON assessment_questions(question_id);

-- ============================================================================
-- Student Assessment Attempts
-- ============================================================================
CREATE TABLE IF NOT EXISTS student_assessment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES unit_assessments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Attempt tracking
  attempt_number INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,

  -- Results
  score NUMERIC(5, 2), -- Total score percentage
  correct_answers INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0,
  passed BOOLEAN,

  -- Metadata
  answers JSONB DEFAULT '{}'::jsonb, -- {questionId: answerValue, ...}
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional data (ip, user_agent, etc.)

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_assessment_attempts_student
  ON student_assessment_attempts(user_id, assessment_id);

CREATE INDEX IF NOT EXISTS idx_student_assessment_attempts_assessment
  ON student_assessment_attempts(assessment_id, submitted_at DESC NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_student_assessment_attempts_submitted
  ON student_assessment_attempts(submitted_at DESC NULLS LAST)
  WHERE submitted_at IS NOT NULL;

-- ============================================================================
-- Competency Gaps (Identified through assessment)
-- ============================================================================
CREATE TABLE IF NOT EXISTS competency_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES unit_assessments(id) ON DELETE CASCADE,

  -- Gap identification
  topic_id TEXT NOT NULL,
  skill_id TEXT NOT NULL, -- e.g., "law:criminal:actus_reus"
  skill_name TEXT NOT NULL,

  -- Severity
  gap_severity NUMERIC(3, 2) CHECK (gap_severity >= 0 AND gap_severity <= 1.0),
  -- 0.0 = minor, 1.0 = major

  -- Remediation
  identified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recommended_lesson_id UUID REFERENCES level(id),
  remediation_attempted BOOLEAN DEFAULT FALSE,
  remediation_completed BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, assessment_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_competency_gaps_user
  ON competency_gaps(user_id, gap_severity DESC);

CREATE INDEX IF NOT EXISTS idx_competency_gaps_skill
  ON competency_gaps(skill_id, gap_severity DESC);

-- ============================================================================
-- Assessment Performance Analytics
-- ============================================================================
CREATE TABLE IF NOT EXISTS assessment_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL UNIQUE REFERENCES unit_assessments(id) ON DELETE CASCADE,

  -- Aggregate statistics
  total_attempts INTEGER DEFAULT 0,
  total_submissions INTEGER DEFAULT 0,
  average_score NUMERIC(5, 2) DEFAULT 0,
  pass_rate NUMERIC(5, 2) DEFAULT 0,
  median_score NUMERIC(5, 2) DEFAULT 0,

  -- Question-level analytics
  question_stats JSONB DEFAULT '{}'::jsonb, -- {questionId: {correct: N, total: M, difficulty: X}}

  -- Timing
  average_time_seconds INTEGER DEFAULT 0,
  median_time_seconds INTEGER DEFAULT 0,

  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_analytics_updated
  ON assessment_analytics(last_updated DESC);

-- ============================================================================
-- Triggers: Auto-update timestamps
-- ============================================================================
DROP TRIGGER IF EXISTS unit_assessments_timestamp ON unit_assessments;

CREATE TRIGGER unit_assessments_timestamp
BEFORE UPDATE ON unit_assessments
FOR EACH ROW
EXECUTE FUNCTION update_unified_progress_timestamp();

DROP TRIGGER IF EXISTS student_assessment_attempts_timestamp ON student_assessment_attempts;

CREATE TRIGGER student_assessment_attempts_timestamp
BEFORE UPDATE ON student_assessment_attempts
FOR EACH ROW
EXECUTE FUNCTION update_unified_progress_timestamp();

DROP TRIGGER IF EXISTS competency_gaps_timestamp ON competency_gaps;

CREATE TRIGGER competency_gaps_timestamp
BEFORE UPDATE ON competency_gaps
FOR EACH ROW
EXECUTE FUNCTION update_unified_progress_timestamp();

-- ============================================================================
-- Helper View: Assessment with Questions
-- ============================================================================
CREATE OR REPLACE VIEW assessments_with_questions AS
SELECT
  ua.id as assessment_id,
  ua.unit_id,
  ua.assessment_type,
  ua.sequence_order,
  ua.passing_score_required,
  ua.time_limit_minutes,
  ua.is_active,
  aq.question_id,
  aq.sequence_order as question_order,
  aq.points,
  aq.difficulty_weight,
  q.prompt,
  q.type,
  q.correct_answer,
  q.explanation
FROM unit_assessments ua
LEFT JOIN assessment_questions aq ON ua.id = aq.assessment_id
LEFT JOIN question q ON aq.question_id = q.id
WHERE ua.is_active = TRUE
ORDER BY ua.sequence_order, aq.sequence_order;

-- ============================================================================
-- Sample Data: Create default assessments for all units
-- ============================================================================
INSERT INTO unit_assessments
  (unit_id, brand_id, assessment_type, sequence_order, passing_score_required, description)
SELECT
  u.id,
  (SELECT id FROM brands WHERE code = 'law'),
  'pre_test',
  1,
  0.50,
  'Pre-test to assess starting knowledge'
FROM unit u
LEFT JOIN unit_assessments ua ON u.id = ua.unit_id AND ua.assessment_type = 'pre_test'
WHERE u.topic_id = 'law:criminal' AND ua.id IS NULL
ON CONFLICT (unit_id, assessment_type) DO NOTHING;

INSERT INTO unit_assessments
  (unit_id, brand_id, assessment_type, sequence_order, passing_score_required, description)
SELECT
  u.id,
  (SELECT id FROM brands WHERE code = 'law'),
  'summative',
  4,
  0.70,
  'Final assessment to verify unit mastery'
FROM unit u
LEFT JOIN unit_assessments ua ON u.id = ua.unit_id AND ua.assessment_type = 'summative'
WHERE u.topic_id = 'law:criminal' AND ua.id IS NULL
ON CONFLICT (unit_id, assessment_type) DO NOTHING;

-- ============================================================================
-- Sample Data: Link some questions to assessments
-- ============================================================================
INSERT INTO assessment_questions (assessment_id, question_id, sequence_order, points)
SELECT
  ua.id,
  q.id,
  ROW_NUMBER() OVER (PARTITION BY ua.id ORDER BY q.id),
  1
FROM unit_assessments ua
JOIN unit u ON ua.unit_id = u.id
JOIN question q ON q.topic_id = u.topic_id
WHERE ua.is_active = TRUE
  AND ua.assessment_type IN ('pre_test', 'summative')
  AND u.topic_id = 'law:criminal'
LIMIT 100
ON CONFLICT (assessment_id, question_id) DO NOTHING;

-- ============================================================================
-- Audit: Log this migration
-- ============================================================================
INSERT INTO progress_sync_log (app_code, sync_type, records_synced, status)
VALUES ('law', 'assessment_system_migration',
  (SELECT COUNT(*) FROM unit_assessments) +
  (SELECT COUNT(*) FROM assessment_questions),
  'success'
);
