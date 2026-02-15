/**
 * Migration: Create Message Schema with Language Annotation
 *
 * This migration creates tables to support:
 * - Word-level language tagging (L1 vs L2)
 * - Error detection and annotation
 * - Flip-able content (toggle L1↔L2 on UI)
 * - Pedagogical analysis for adaptive assessment
 * - AI response tracking
 */

export async function up(db) {
  try {
    // Drop old simple message table if it exists
    try {
      db.exec(`DROP TABLE IF EXISTS message;`);
    } catch (e) {
      // Ignore if table doesn't exist
    }

    // ============================================
    // MESSAGE TABLE
    // ============================================
    db.exec(`CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL CHECK (sender_role IN ('student', 'ai', 'teacher')),
      message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'system', 'assessment_trigger')),
      raw_text TEXT NOT NULL,
      target_language VARCHAR(2),
      created_at TEXT DEFAULT (datetime('now')),
      message_index INTEGER
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_room ON message(room_id, created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_role ON message(sender_role)`);

    // ============================================
    // MESSAGE_SEGMENT TABLE
    // ============================================
    db.exec(`CREATE TABLE IF NOT EXISTS message_segment (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      segment_index INTEGER NOT NULL,
      segment_text TEXT NOT NULL,
      language_code VARCHAR(10) NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      is_error BOOLEAN DEFAULT FALSE,
      error_type VARCHAR(50),
      correction TEXT,
      error_explanation TEXT,
      error_confidence REAL,
      is_new_vocabulary BOOLEAN DEFAULT FALSE,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_segment_message ON message_segment(message_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_segment_error ON message_segment(message_id, is_error)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_segment_language ON message_segment(language_code)`);

    // ============================================
    // MESSAGE_ANALYSIS TABLE
    // ============================================
    db.exec(`CREATE TABLE IF NOT EXISTS message_analysis (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL UNIQUE REFERENCES message(id) ON DELETE CASCADE,
      language_distribution TEXT NOT NULL,
      error_count INTEGER DEFAULT 0,
      error_rate REAL,
      error_types TEXT,
      vocabulary_analysis TEXT,
      grammar_structures TEXT,
      confidence_indicators TEXT,
      demonstrated_topics TEXT,
      identified_gaps TEXT,
      should_trigger_unit BOOLEAN DEFAULT FALSE,
      trigger_reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_analysis_message ON message_analysis(message_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_analysis_trigger ON message_analysis(should_trigger_unit)`);

    // ============================================
    // AI_RESPONSE TABLE
    // ============================================
    db.exec(`CREATE TABLE IF NOT EXISTS ai_response (
      id TEXT PRIMARY KEY,
      ai_message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      responding_to_message_id TEXT REFERENCES message(id) ON DELETE SET NULL,
      pedagogical_intent VARCHAR(50),
      incorporates_topics TEXT,
      corrects_error_implicitly BOOLEAN DEFAULT FALSE,
      corrected_error_type VARCHAR(50),
      introduces_vocabulary TEXT,
      difficulty_level VARCHAR(5),
      complexity_score REAL,
      transitioning_to_unit BOOLEAN DEFAULT FALSE,
      transition_unit_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_response_ai_message ON ai_response(ai_message_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_response_responding_to ON ai_response(responding_to_message_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_response_intent ON ai_response(pedagogical_intent)`);

    // ============================================
    // ALTER chat_room TABLE
    // ============================================
    try {
      db.exec(`ALTER TABLE chat_room ADD COLUMN ai_context TEXT`);
    } catch (e) {
      // Column might already exist
    }
    try {
      db.exec(`ALTER TABLE chat_room ADD COLUMN language_code VARCHAR(2)`);
    } catch (e) {
      // Column might already exist
    }
    try {
      db.exec(`ALTER TABLE chat_room ADD COLUMN assessment_interval INTEGER DEFAULT 20`);
    } catch (e) {
      // Column might already exist
    }
    try {
      db.exec(`ALTER TABLE chat_room ADD COLUMN last_assessment_at TEXT`);
    } catch (e) {
      // Column might already exist
    }

    console.log('✓ Migration 002: Message schema created successfully');
    return true;
  } catch (error) {
    console.error('✗ Migration 002 failed:', error.message);
    throw error;
  }
}

export async function down(db) {
  try {
    db.exec(`DROP TABLE IF EXISTS ai_response`);
    db.exec(`DROP TABLE IF EXISTS message_analysis`);
    db.exec(`DROP TABLE IF EXISTS message_segment`);
    db.exec(`DROP TABLE IF EXISTS message`);

    console.log('✓ Migration 002 rolled back');
    return true;
  } catch (error) {
    console.error('✗ Migration 002 rollback failed:', error.message);
    throw error;
  }
}
