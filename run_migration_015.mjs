import db from './db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  console.log('=== Running Migration 015 Manually ===\n');

  // Read the migration file
  const migrationPath = path.join(__dirname, 'migrations', '015_lawlore_curriculum.sql');
  const migrationSQL = await fs.readFile(migrationPath, 'utf8');

  console.log('Migration SQL length:', migrationSQL.length);
  console.log('First 500 chars:', migrationSQL.substring(0, 500));
  console.log('\n');

  // Execute the migration
  console.log('Executing migration...');
  const result = await db.query(migrationSQL);
  console.log('✅ Migration executed successfully');
  console.log('Result:', result);

  // Check if data was inserted
  const topicCount = await db.one('SELECT COUNT(*) as count FROM topic WHERE id LIKE $1', ['law:%']);
  console.log(`\n✅ Topics created after migration: ${topicCount.count}`);

  const unitCount = await db.one('SELECT COUNT(*) as count FROM unit WHERE topic_id LIKE $1', ['law:%']);
  console.log(`✅ Units created after migration: ${unitCount.count}`);

} catch (err) {
  console.error('❌ Error:', err.message);
  console.error('Stack:', err.stack);
}

process.exit(0);
