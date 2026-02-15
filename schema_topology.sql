-- ============================================
-- TOPIC HIERARCHY SCHEMA (MVP Database)
-- ============================================
-- DAG (Directed Acyclic Graph) structure
-- Topics can have multiple parents and children
-- Example: "Past Perfect Conditional" has parents:
--   - Past Tenses (under Verb Tenses)
--   - Conditionals (under Modal Verbs)
-- ============================================

CREATE TABLE topic_hierarchy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys to curriculum_statements (curriculum DB)
  child_topic_id TEXT NOT NULL,
  parent_topic_id TEXT NOT NULL,

  -- Sequencing: if a topic has multiple parents, which path is primary?
  -- Priority 1 = preferred learning path, priority 2 = alternative, etc
  priority INTEGER DEFAULT 1,

  -- Human-readable reason why this relationship exists
  -- "conditional requires past tense understanding"
  relationship_reason TEXT,

  -- Is this relationship required (prerequisite) or recommended (helpful)?
  relationship_type VARCHAR(20) NOT NULL DEFAULT 'prerequisite'
    CHECK (relationship_type IN ('prerequisite', 'related', 'reinforces')),

  -- Pedagogical metadata
  -- Minimum student level before this relationship is active
  -- (Y7 might not need Perfect Conditional, but Y9 does)
  min_level VARCHAR(5) DEFAULT 'F-2',

  -- Can student skip this prerequisite?
  can_skip BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- UNIT TABLE (augmented)
-- ============================================
CREATE TABLE unit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to topic (single topic per unit)
  topic_id TEXT NOT NULL,
  language VARCHAR(2) NOT NULL,

  -- Difficulty level from curriculum
  difficulty_level VARCHAR(5) NOT NULL CHECK (difficulty_level IN ('F-2', '3-4', '5-6', '7-8', '9-10', '11-12')),

  -- Human-readable name
  -- "Past Tense - Introduction" or "Past Perfect Conditional - Advanced"
  name TEXT NOT NULL,

  -- Sequencing within same topic+difficulty
  -- If "Past Tense" at Y7 has 3 units, which is first?
  unit_order INTEGER DEFAULT 0,

  -- Prerequisite units (can't do this unit until completing these)
  prerequisite_unit_ids UUID[] DEFAULT '{}',

  -- Topics this unit reinforces/teaches
  -- Denormalized for fast access in nextUnits() function
  teaches_topics TEXT[] NOT NULL,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- LEVEL TABLE (augmented)
-- ============================================
CREATE TABLE level (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which unit does this level belong to?
  unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE CASCADE,

  -- Type: lesson (educational, "click OK") or question (MCQ/fill)
  type VARCHAR(20) NOT NULL CHECK (type IN ('lesson', 'question')),

  -- For questions: 'mcq' or 'fill'
  question_type VARCHAR(20),

  -- Question content
  -- For lesson: HTML/markdown instructional content
  -- For question: the prompt/question text
  content TEXT,

  -- For questions: the correct answer
  -- MCQ: integer index (0, 1, 2, etc)
  -- Fill: exact text string
  correct_answer TEXT,

  -- MCQ-specific: JSON array of options
  options JSONB,

  -- Metadata (difficulty, skills tested, vocab focus)
  metadata JSONB DEFAULT '{}',

  -- Order within unit (lesson first, then questions)
  level_order INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- LEVEL_PROGRESS TABLE
-- ============================================
CREATE TABLE level_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL,
  level_id UUID NOT NULL REFERENCES level(id) ON DELETE CASCADE,

  -- When did they start/complete?
  started_at TIMESTAMP,
  completed_at TIMESTAMP,

  -- For questions: what did they answer?
  user_answer TEXT,

  -- For questions: was it correct?
  is_correct BOOLEAN,

  -- How long did they spend on this level?
  time_spent_seconds INTEGER,

  -- Attempt number (1st try, 2nd try, etc)
  attempt_number INTEGER DEFAULT 1,

  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, level_id, attempt_number)
);

-- ============================================
-- UNIT_ASSIGNMENT TABLE
-- ============================================
CREATE TABLE unit_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL,
  unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE CASCADE,

  -- Who assigned it?
  assigned_by VARCHAR(20) NOT NULL CHECK (assigned_by IN ('ai', 'teacher', 'student_request')),

  -- Why was it assigned?
  assignment_reason TEXT,

  -- Status in the progression
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),

  -- When assigned/completed?
  assigned_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,

  -- Performance on the unit
  unit_score FLOAT,

  -- Did they improve after this unit in chat?
  post_unit_assessment JSONB,

  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- STUDENT_ASSESSMENT TABLE
-- ============================================
CREATE TABLE student_assessment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL,
  language VARCHAR(2) NOT NULL,

  -- Current assessed level
  current_level VARCHAR(5),

  -- Language production metrics (from chat analysis)
  target_language_pct FLOAT DEFAULT 0,  -- % of messages in French/Spanish
  fluency_score FLOAT DEFAULT 0,        -- words per minute, smoothness
  error_rate FLOAT DEFAULT 1,           -- errors per 100 words
  confidence_level VARCHAR(20),         -- low, medium, high

  -- Identified gaps (topics needing work)
  competency_gaps TEXT[] DEFAULT '{}',  -- e.g., ["past_tense", "questions", "formal_address"]

  -- When was this assessment made?
  assessed_at TIMESTAMP DEFAULT NOW(),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX idx_topic_hierarchy_child ON topic_hierarchy(child_topic_id);
CREATE INDEX idx_topic_hierarchy_parent ON topic_hierarchy(parent_topic_id);
CREATE INDEX idx_topic_hierarchy_relationship ON topic_hierarchy(child_topic_id, parent_topic_id, priority);

CREATE INDEX idx_unit_topic ON unit(topic_id, language);
CREATE INDEX idx_unit_difficulty ON unit(difficulty_level);

CREATE INDEX idx_level_unit ON level(unit_id);
CREATE INDEX idx_level_type ON level(type);

CREATE INDEX idx_level_progress_user ON level_progress(user_id);
CREATE INDEX idx_level_progress_level ON level_progress(level_id);
CREATE INDEX idx_level_progress_completed ON level_progress(user_id, completed_at);

CREATE INDEX idx_unit_assignment_user ON unit_assignment(user_id);
CREATE INDEX idx_unit_assignment_status ON unit_assignment(user_id, status);

CREATE INDEX idx_student_assessment_user ON student_assessment(user_id, language);
CREATE INDEX idx_student_assessment_recent ON student_assessment(user_id, assessed_at DESC);

-- ============================================
-- CONSTRAINTS & TRIGGERS
-- ============================================

-- Prevent cycles in topic_hierarchy (no topic can be ancestor of itself)
-- This would require a trigger, implementation:
CREATE OR REPLACE FUNCTION check_topic_hierarchy_cycle()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if adding this edge would create a cycle
  -- Simple check: parent cannot be equal to child
  IF NEW.child_topic_id = NEW.parent_topic_id THEN
    RAISE EXCEPTION 'Topic cannot be its own parent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER topic_hierarchy_cycle_check
BEFORE INSERT OR UPDATE ON topic_hierarchy
FOR EACH ROW
EXECUTE FUNCTION check_topic_hierarchy_cycle();

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_topic_hierarchy_timestamp BEFORE UPDATE ON topic_hierarchy
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_unit_timestamp BEFORE UPDATE ON unit
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_student_assessment_timestamp BEFORE UPDATE ON student_assessment
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
