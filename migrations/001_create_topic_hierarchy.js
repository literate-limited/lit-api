/**
 * Migration: Create topic hierarchy and unit structure
 * This creates the DAG (Directed Acyclic Graph) for topic relationships
 * and the unit/level progression system
 *
 * Note: Uses SQLite syntax (TEXT for UUIDs, TEXT for JSON, text timestamps)
 */

export async function up(db) {
  console.log('Creating topic hierarchy schema...');

  try {
    // Create topic_hierarchy table (many-to-many parent-child relationships)
    db.exec(`
      CREATE TABLE IF NOT EXISTS topic_hierarchy (
        id TEXT PRIMARY KEY,
        child_topic_id TEXT NOT NULL,
        parent_topic_id TEXT NOT NULL,
        priority INTEGER DEFAULT 1,
        relationship_reason TEXT,
        relationship_type TEXT NOT NULL DEFAULT 'prerequisite'
          CHECK (relationship_type IN ('prerequisite', 'related', 'reinforces')),
        min_level TEXT DEFAULT 'F-2',
        can_skip BOOLEAN DEFAULT FALSE,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_topic_hierarchy_child ON topic_hierarchy(child_topic_id);
      CREATE INDEX IF NOT EXISTS idx_topic_hierarchy_parent ON topic_hierarchy(parent_topic_id);
      CREATE INDEX IF NOT EXISTS idx_topic_hierarchy_relationship ON topic_hierarchy(child_topic_id, parent_topic_id, priority);
    `);

    // Create unit table
    db.exec(`
      CREATE TABLE IF NOT EXISTS unit (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        language TEXT NOT NULL,
        difficulty_level TEXT NOT NULL,
        name TEXT NOT NULL,
        unit_order INTEGER DEFAULT 0,
        prerequisite_unit_ids TEXT,
        teaches_topics TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_unit_topic ON unit(topic_id, language);
      CREATE INDEX IF NOT EXISTS idx_unit_difficulty ON unit(difficulty_level);
    `);

    // Create level table
    db.exec(`
      CREATE TABLE IF NOT EXISTS level (
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        question_type TEXT,
        content TEXT,
        correct_answer TEXT,
        options TEXT,
        metadata TEXT DEFAULT '{}',
        level_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_level_unit ON level(unit_id);
      CREATE INDEX IF NOT EXISTS idx_level_type ON level(type);
    `);

    // Create level_progress table
    db.exec(`
      CREATE TABLE IF NOT EXISTS level_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        level_id TEXT NOT NULL REFERENCES level(id) ON DELETE CASCADE,
        started_at TEXT,
        completed_at TEXT,
        user_answer TEXT,
        is_correct BOOLEAN,
        time_spent_seconds INTEGER,
        attempt_number INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, level_id, attempt_number)
      );

      CREATE INDEX IF NOT EXISTS idx_level_progress_user ON level_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_level_progress_level ON level_progress(level_id);
    `);

    // Create unit_assignment table
    db.exec(`
      CREATE TABLE IF NOT EXISTS unit_assignment (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        unit_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
        assigned_by TEXT NOT NULL,
        assignment_reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_at TEXT DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        unit_score REAL,
        post_unit_assessment TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_unit_assignment_user ON unit_assignment(user_id);
      CREATE INDEX IF NOT EXISTS idx_unit_assignment_status ON unit_assignment(user_id, status);
    `);

    // Create student_assessment table
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_assessment (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        current_level TEXT,
        target_language_pct REAL DEFAULT 0,
        fluency_score REAL DEFAULT 0,
        error_rate REAL DEFAULT 1,
        confidence_level TEXT,
        competency_gaps TEXT DEFAULT '[]',
        assessed_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_student_assessment_user ON student_assessment(user_id, language);
    `);

    console.log('✅ Topic hierarchy schema created');
    return true;
  } catch (error) {
    console.error('✗ Migration 001 failed:', error.message);
    throw error;
  }
}

export async function down(db) {
  console.log('Dropping topic hierarchy schema...');

  try {
    db.exec(`
      DROP TABLE IF EXISTS student_assessment;
      DROP TABLE IF EXISTS unit_assignment;
      DROP TABLE IF EXISTS level_progress;
      DROP TABLE IF EXISTS level;
      DROP TABLE IF EXISTS unit;
      DROP TABLE IF EXISTS topic_hierarchy;
    `);

    console.log('✅ Topic hierarchy schema dropped');
    return true;
  } catch (error) {
    console.error('✗ Migration 001 rollback failed:', error.message);
    throw error;
  }
}
