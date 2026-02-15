-- Migration: Extend question table for placement tests
-- Adds fields needed for Math Madness placement test

-- Add new columns to existing question table
ALTER TABLE question
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS question_format TEXT DEFAULT 'mcq',
  ADD COLUMN IF NOT EXISTS options JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS acceptable_answers JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS difficulty TEXT,
  ADD COLUMN IF NOT EXISTS difficulty_score INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add check constraints for new fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_subject_check'
  ) THEN
    ALTER TABLE question ADD CONSTRAINT question_subject_check CHECK (subject IN (
      'math', 'algebra', 'geometry', 'calculus', 'statistics',
      'english', 'reading', 'writing', 'grammar',
      'science', 'physics', 'chemistry', 'biology',
      'history', 'geography', 'general'
    ) OR subject IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_format_check'
  ) THEN
    ALTER TABLE question ADD CONSTRAINT question_format_check CHECK (question_format IN (
      'mcq', 'fill', 'numerical', 'text', 'essay'
    ) OR question_format IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_difficulty_check'
  ) THEN
    ALTER TABLE question ADD CONSTRAINT question_difficulty_check CHECK (difficulty IN (
      'beginner', 'easy', 'medium', 'hard', 'expert',
      'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6',
      'Y7', 'Y8', 'Y9', 'Y10', 'Y11', 'Y12',
      'A1', 'A2', 'B1', 'B2', 'C1', 'C2'
    ) OR difficulty IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_difficulty_score_check'
  ) THEN
    ALTER TABLE question ADD CONSTRAINT question_difficulty_score_check
    CHECK (difficulty_score BETWEEN 1 AND 100 OR difficulty_score IS NULL);
  END IF;
END $$;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_question_subject ON question(subject);
CREATE INDEX IF NOT EXISTS idx_question_difficulty ON question(difficulty);
CREATE INDEX IF NOT EXISTS idx_question_difficulty_score ON question(difficulty_score);
CREATE INDEX IF NOT EXISTS idx_question_active ON question(active);
CREATE INDEX IF NOT EXISTS idx_question_tags ON question USING GIN(tags);

-- Table for linking questions to placement tests
CREATE TABLE IF NOT EXISTS placement_test_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    question_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(class_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_placement_test_questions_class ON placement_test_questions(class_id);
CREATE INDEX IF NOT EXISTS idx_placement_test_questions_question ON placement_test_questions(question_id);

-- Table for storing student question attempts
CREATE TABLE IF NOT EXISTS question_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,

    -- What did they answer?
    user_answer TEXT,

    -- Was it correct?
    is_correct BOOLEAN NOT NULL,

    -- How long did they take?
    time_spent_seconds INTEGER,

    -- Context (placement test, quiz, practice)
    context TEXT,
    context_id UUID,

    -- Attempt number for this question
    attempt_number INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_question_attempts_user ON question_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_question ON question_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_context ON question_attempts(context, context_id);
