import db from './db.js';

try {
  console.log('=== Checking law topics ===\n');

  // Get all law topics
  const topics = await db.many(`
    SELECT id, name, language, brand_id
    FROM topic
    WHERE id LIKE $1
    ORDER BY id
  `, ['law:%']);

  console.log(`Law topics found: ${topics.length}`);
  topics.forEach(t => {
    console.log(`  - ${t.id}: ${t.name}`);
  });

  if (topics.length === 0) {
    // Check all topics in database
    const allTopics = await db.many('SELECT id, name, language FROM topic LIMIT 10');
    console.log(`\nSample topics in database (any language):`);
    allTopics.forEach(t => {
      console.log(`  - ${t.id}: ${t.name} (${t.language})`);
    });
  }

} catch (err) {
  console.error('Error:', err.message);
  console.error(err);
}

process.exit(0);
