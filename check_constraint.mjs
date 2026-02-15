import db from './db.js';

try {
  console.log('=== Checking question table constraints ===\n');

  // Get column info
  const columns = await db.many(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'question'
    ORDER BY ordinal_position
  `);

  console.log('Question table columns:');
  columns.forEach(c => {
    console.log(`  - ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable})`);
  });

  // Get constraints
  const constraints = await db.many(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = 'question'
  `);

  console.log('\nConstraints:');
  constraints.forEach(c => {
    console.log(`  - ${c.constraint_name} (${c.constraint_type})`);
  });

  // Check for the subject check constraint
  const checkConstraints = await db.many(`
    SELECT
      constraint_name,
      check_clause
    FROM information_schema.check_constraints
    WHERE constraint_name LIKE '%question%'
  `);

  console.log('\nCheck constraints:');
  checkConstraints.forEach(c => {
    console.log(`  - ${c.constraint_name}:`);
    console.log(`    ${c.check_clause}`);
  });

  // Get sample question
  const sampleQ = await db.one('SELECT id, subject, prompt FROM question LIMIT 1');
  console.log('\nSample question:');
  console.log(`  subject: ${sampleQ.subject}`);
  console.log(`  prompt: ${sampleQ.prompt}`);

} catch (err) {
  console.error('Error:', err.message);
}

process.exit(0);
