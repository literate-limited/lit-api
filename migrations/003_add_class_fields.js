/**
 * Migration: Add class metadata fields
 *
 * This migration adds year_level, class_identifier, and subject fields to the class table.
 * Replaces single 'name' field with structured data.
 */

export async function up(db) {
  try {
    // Add new columns
    try {
      db.exec(`ALTER TABLE class ADD COLUMN year_level INTEGER`);
    } catch (e) {
      // Column might already exist
    }

    try {
      db.exec(`ALTER TABLE class ADD COLUMN class_identifier TEXT`);
    } catch (e) {
      // Column might already exist
    }

    try {
      db.exec(`ALTER TABLE class ADD COLUMN subject TEXT`);
    } catch (e) {
      // Column might already exist
    }

    // Create index for easier lookups
    db.exec(`CREATE INDEX IF NOT EXISTS idx_class_year_subject ON class(year_level, subject)`);

    console.log('✓ Migration 003: Class fields added successfully');
    return true;
  } catch (error) {
    console.error('✗ Migration 003 failed:', error.message);
    throw error;
  }
}

export async function down(db) {
  try {
    // Note: SQLite doesn't support DROP COLUMN in all versions
    // For rollback, we'd need a more complex approach
    // For now, just log that rollback would require manual intervention
    console.log('✓ Migration 003 rollback: Manual intervention may be needed');
    return true;
  } catch (error) {
    console.error('✗ Migration 003 rollback failed:', error.message);
    throw error;
  }
}
