-- ============================================
-- MESSAGE SCHEMA FOR AI-LED LEARNING CHAT
-- ============================================
-- Supports:
-- - Language segmentation (L1/L2 tagging)
-- - Error detection and annotation
-- - Flip-able content (toggle L1↔L2)
-- - Pedagogical analysis for assessment
-- - AI response tracking
-- ============================================

CREATE TABLE message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Chat context
  room_id UUID NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Who sent it: 'student', 'ai', 'teacher'
  sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('student', 'ai', 'teacher')),

  -- Message type: 'text', 'system', 'assessment_trigger'
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',

  -- Raw text exactly as sent
  raw_text TEXT NOT NULL,

  -- Which language were they targeting? (for student messages)
  target_language VARCHAR(2),

  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW(),

  -- Index for efficient ordering
  message_index BIGSERIAL
);

-- ============================================
-- MESSAGE_SEGMENT
-- ============================================
-- Word/phrase-level breakdown with language tags
-- Allows flip-able content (select phrase, toggle L1↔L2)
-- Example:
--   raw_text: "Je want aller au cinema"
--   segments: [
--     {text: "Je", language: "fr", position: 0-2},
--     {text: "want", language: "en", position: 3-7, is_error: true, error_type: "vocabulary"},
--     {text: "aller au cinema", language: "fr", position: 8-22}
--   ]
-- ============================================

CREATE TABLE message_segment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  message_id UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,

  -- Order within message (for reconstruction)
  segment_index INTEGER NOT NULL,

  -- The actual text of this segment
  segment_text TEXT NOT NULL,

  -- Which language: 'fr', 'en', 'es', 'mixed', 'unknown'
  language_code VARCHAR(10) NOT NULL,

  -- Character position in raw_text (for highlighting)
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,

  -- Is this segment an error?
  is_error BOOLEAN DEFAULT FALSE,

  -- Error classification (only if is_error = true)
  error_type VARCHAR(50),
  -- Examples: 'vocabulary', 'grammar', 'spelling', 'syntax', 'conjugation', 'agreement', 'register'

  -- What it should be (suggestion)
  correction TEXT,

  -- Explanation of why it's wrong (pedagogical)
  error_explanation TEXT,

  -- Confidence score that this is actually an error (0-1)
  error_confidence FLOAT,

  -- Is this a new word for the student? (pedagogical tracking)
  is_new_vocabulary BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- MESSAGE_ANALYSIS
-- ============================================
-- High-level analysis of student messages
-- Used for student assessment updates
-- ============================================

CREATE TABLE message_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  message_id UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,

  -- Language distribution in this message
  language_distribution JSONB NOT NULL,
  -- {
  --   "target_language_pct": 0.66,
  --   "l1_pct": 0.33,
  --   "mixed_pct": 0.0,
  --   "unknown_pct": 0.0
  -- }

  -- Error summary
  error_count INTEGER DEFAULT 0,
  error_rate FLOAT,
  -- Errors per 100 words
  error_types JSONB,
  -- { "vocabulary": 2, "grammar": 1, "spelling": 0 }

  -- Vocabulary metrics
  vocabulary_analysis JSONB,
  -- {
  --   "unique_words": 15,
  --   "known_words": 12,
  --   "new_words": 3,
  --   "repetition_count": 5,
  --   "complexity_score": 0.65
  -- }

  -- Grammar structures attempted
  grammar_structures JSONB,
  -- ["present_tense", "question_formation", "possessive_adjectives"]

  -- Confidence/fluency indicators
  confidence_indicators JSONB,
  -- {
  --   "fluency_score": 0.7,  (word speed, pauses)
  --   "complexity_level": "intermediate",
  --   "self_correction_attempts": 2
  -- }

  -- Topics/competencies demonstrated in this message
  demonstrated_topics TEXT[] DEFAULT '{}',
  -- Example: ["greetings", "present_tense", "asking_questions"]

  -- Identified gaps (what they tried but struggled with)
  identified_gaps TEXT[] DEFAULT '{}',
  -- Example: ["past_tense", "formal_address"]

  -- Should this message trigger a unit assignment?
  should_trigger_unit BOOLEAN DEFAULT FALSE,
  trigger_reason TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- AI_RESPONSE
-- ============================================
-- Metadata about AI responses to student messages
-- Tracks pedagogical intent
-- ============================================

CREATE TABLE ai_response (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The AI's message
  ai_message_id UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,

  -- What message was it responding to?
  responding_to_message_id UUID REFERENCES message(id) ON DELETE SET NULL,

  -- Pedagogical intent: what is the AI trying to do?
  -- 'confirm', 'correct_implicitly', 'extend_vocabulary', 'practice_structure',
  -- 'introduce_topic', 'assess', 'celebrate', 'clarify'
  pedagogical_intent VARCHAR(50),

  -- Topics/skills this response incorporates or reinforces
  incorporates_topics TEXT[] DEFAULT '{}',
  -- Example: ["past_tense", "question_formation"]

  -- Does this response implicitly correct student errors?
  -- (by using the correct form in context, without saying "you're wrong")
  corrects_error_implicitly BOOLEAN DEFAULT FALSE,
  corrected_error_type VARCHAR(50),

  -- New vocabulary introduced in this response
  introduces_vocabulary TEXT[] DEFAULT '{}',

  -- Difficulty level of vocabulary/grammar in response
  difficulty_level VARCHAR(5),

  -- Complexity score (0-1) of the AI response
  complexity_score FLOAT,

  -- Does this response transition toward a unit?
  -- (e.g., "You've been asking great questions. Let me teach you past tense properly...")
  transitioning_to_unit BOOLEAN DEFAULT FALSE,
  transition_unit_id UUID REFERENCES unit(id) ON DELETE SET NULL,

  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- CHAT_ROOM (augmented)
-- ============================================
-- Add pedagogical context to chat rooms

ALTER TABLE chat_room ADD COLUMN IF NOT EXISTS
  ai_context JSONB,
  -- {
  --   "teaching_focus": ["past_tense", "questions"],
  --   "target_vocabulary": ["restaurant", "menu", "order"],
  --   "difficulty_level": "Y7",
  --   "current_unit_id": "unit-uuid-123"
  -- }

  ADD COLUMN IF NOT EXISTS
  language_code VARCHAR(2),
  -- 'fr' or 'es'

  ADD COLUMN IF NOT EXISTS
  assessment_interval INTEGER DEFAULT 20,
  -- Reassess student every N messages

  ADD COLUMN IF NOT EXISTS
  last_assessment_at TIMESTAMP;
  -- When was the last formal assessment?

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_message_room ON message(room_id, created_at DESC);
CREATE INDEX idx_message_sender ON message(sender_id);
CREATE INDEX idx_message_role ON message(sender_role);

CREATE INDEX idx_message_segment_message ON message_segment(message_id);
CREATE INDEX idx_message_segment_error ON message_segment(message_id, is_error);
CREATE INDEX idx_message_segment_language ON message_segment(language_code);

CREATE INDEX idx_message_analysis_message ON message_analysis(message_id);
CREATE INDEX idx_message_analysis_gaps ON message_analysis USING GIN(identified_gaps);
CREATE INDEX idx_message_analysis_trigger ON message_analysis(should_trigger_unit);

CREATE INDEX idx_ai_response_ai_message ON ai_response(ai_message_id);
CREATE INDEX idx_ai_response_responding_to ON ai_response(responding_to_message_id);
CREATE INDEX idx_ai_response_intent ON ai_response(pedagogical_intent);

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- Reconstruct a message from segments (for display)
CREATE OR REPLACE VIEW message_with_segments AS
SELECT
  m.id,
  m.room_id,
  m.sender_id,
  m.sender_role,
  m.raw_text,
  m.created_at,
  JSON_AGG(JSON_BUILD_OBJECT(
    'text', ms.segment_text,
    'language', ms.language_code,
    'is_error', ms.is_error,
    'error_type', ms.error_type,
    'correction', ms.correction,
    'error_explanation', ms.error_explanation
  ) ORDER BY ms.segment_index) as segments
FROM message m
LEFT JOIN message_segment ms ON m.id = ms.message_id
GROUP BY m.id, m.room_id, m.sender_id, m.sender_role, m.raw_text, m.created_at;

-- Get student message with analysis
CREATE OR REPLACE VIEW student_message_analysis AS
SELECT
  m.id,
  m.room_id,
  m.raw_text,
  m.created_at,
  ma.language_distribution,
  ma.error_count,
  ma.error_rate,
  ma.identified_gaps,
  ma.should_trigger_unit,
  ar.ai_message_id as ai_response_id,
  ar.pedagogical_intent
FROM message m
LEFT JOIN message_analysis ma ON m.id = ma.message_id
LEFT JOIN ai_response ar ON m.id = ar.responding_to_message_id
WHERE m.sender_role = 'student'
ORDER BY m.created_at DESC;

-- ============================================
-- TRIGGERS & FUNCTIONS
-- ============================================

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_message_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Calculate segment positions if not provided
-- (for cases where segments are generated programmatically)
CREATE OR REPLACE FUNCTION ensure_segment_positions()
RETURNS TRIGGER AS $$
DECLARE
  v_char_position INTEGER;
BEGIN
  IF NEW.char_start IS NULL OR NEW.char_end IS NULL THEN
    -- This would require complex logic to recalculate from raw_text
    -- For now, rely on the application to provide positions
    RAISE EXCEPTION 'char_start and char_end are required for message_segment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_segment_position_check
BEFORE INSERT OR UPDATE ON message_segment
FOR EACH ROW
EXECUTE FUNCTION ensure_segment_positions();

-- ============================================
-- EXAMPLE: How chat data flows
-- ============================================
/*

1. STUDENT TYPES MESSAGE:
   "Je want aller au cinema demain"

2. INSERT INTO message:
   - id: uuid-123
   - room_id: room-xyz
   - sender_id: student-456
   - sender_role: 'student'
   - raw_text: "Je want aller au cinema demain"
   - target_language: 'fr'

3. NLP SERVICE ANALYZES (from Claude or spaCy):
   - Tokenizes: ["Je", "want", "aller", "au", "cinema", "demain"]
   - Language tags: [fr, en, fr, fr, fr, fr]
   - Errors: "want" should be "veux"

4. INSERT INTO message_segment (multiple rows):
   - {message_id, segment_index: 0, text: "Je", language: "fr", char_start: 0, char_end: 2}
   - {message_id, segment_index: 1, text: "want", language: "en", is_error: true,
     error_type: "vocabulary", correction: "veux", char_start: 3, char_end: 7}
   - {message_id, segment_index: 2, text: "aller au cinema demain", language: "fr",
     char_start: 8, char_end: 29}

5. INSERT INTO message_analysis:
   - language_distribution: {target: 0.83, l1: 0.17}
   - error_count: 1
   - error_rate: 20.0 (1 error per 5 words)
   - identified_gaps: ["present_tense_verb_conjugation"]
   - should_trigger_unit: false (one error is normal)

6. AI GENERATES RESPONSE:
   "Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?"

7. INSERT INTO message (AI response):
   - id: uuid-789
   - room_id: room-xyz
   - sender_id: ai-system
   - sender_role: 'ai'
   - raw_text: "Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?"

8. INSERT INTO ai_response:
   - ai_message_id: uuid-789
   - responding_to_message_id: uuid-123
   - pedagogical_intent: 'correct_implicitly'  (uses correct "veux" naturally)
   - corrects_error_implicitly: true
   - corrected_error_type: 'verb_conjugation'
   - incorporates_topics: ["present_tense_vouloir", "movie_vocabulary"]

9. STUDENT SEES (in UI):
   Their message with flippable segments:
   [Je] [want→veux] [aller au cinema demain]

   AI response (normal display):
   "Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?"

10. CONTINUOUS ASSESSMENT:
    - Every 20 messages, updateStudentAssessment() runs
    - Aggregates error patterns, vocabulary growth, topic gaps
    - Calls computeNextUnits() to update recommendations
*/
