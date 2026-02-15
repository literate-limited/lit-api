import db from './db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  console.log('=== Rerunning Migration 015 ===\n');

  // Check if migration was previously executed
  const alreadyRun = await db.one('SELECT 1 FROM migrations WHERE name = $1', ['015_lawlore_curriculum']);

  if (alreadyRun) {
    console.log('Migration 015 was previously executed. Deleting record to rerun...');
    await db.query('DELETE FROM migrations WHERE name = $1', ['015_lawlore_curriculum']);
    console.log('✅ Deleted migration record\n');
  }

  // Read and execute the migration
  const migrationPath = path.join(__dirname, 'migrations', '015_lawlore_curriculum.sql');
  const migrationSQL = await fs.readFile(migrationPath, 'utf8');

  console.log('Executing migration...');
  await db.query(migrationSQL);
  console.log('✅ Migration executed successfully\n');

  // Mark as executed
  await db.query('INSERT INTO migrations (name) VALUES ($1)', ['015_lawlore_curriculum']);
  console.log('✅ Migration marked as complete\n');

  // Verify data was inserted
  const topicCount = await db.one('SELECT COUNT(*) as count FROM topic WHERE id LIKE $1', ['law:%']);
  console.log(`✅ Topics created: ${topicCount.count}`);

  const unitCount = await db.one('SELECT COUNT(*) as count FROM unit WHERE topic_id LIKE $1', ['law:%']);
  console.log(`✅ Units created: ${unitCount.count}`);

  const lessonCount = await db.one('SELECT COUNT(*) as count FROM level WHERE unit_id IN (SELECT id FROM unit WHERE topic_id LIKE $1)', ['law:%']);
  console.log(`✅ Lessons created: ${lessonCount.count}`);

  const questionCount = await db.one('SELECT COUNT(*) as count FROM question WHERE topic_id LIKE $1', ['law:%']);
  console.log(`✅ Questions created: ${questionCount.count}`);

  console.log('\n🎉 Lawlore Phase 3 curriculum successfully loaded!');

} catch (err) {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
}

process.exit(0);
