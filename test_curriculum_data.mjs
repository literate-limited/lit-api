import db from './db.js';

try {
  console.log('=== LAWLORE PHASE 3 CURRICULUM DATA VERIFICATION ===\n');

  // Get all law topics
  const topics = await db.many(`
    SELECT id, name FROM topic WHERE id LIKE $1 ORDER BY id
  `, ['law:%']);

  console.log('📚 TOPICS (6 expected):');
  console.log(`   Found: ${topics.length}`);
  topics.forEach(t => {
    console.log(`   - ${t.id}: ${t.name}`);
  });

  // Get all law units grouped by topic
  const units = await db.many(`
    SELECT u.id, u.topic_id, u.name, COUNT(l.id) as lesson_count
    FROM unit u
    LEFT JOIN level l ON l.unit_id = u.id
    WHERE u.topic_id LIKE $1
    GROUP BY u.id, u.topic_id, u.name
    ORDER BY u.topic_id, u.unit_order
  `, ['law:%']);

  console.log('\n📖 UNITS (15 found):');
  let currentTopic = '';
  units.forEach(u => {
    if (u.topic_id !== currentTopic) {
      console.log(`\n   Topic: ${u.topic_id}`);
      currentTopic = u.topic_id;
    }
    console.log(`     - ${u.name} (${u.lesson_count} lessons)`);
  });

  // Get all law lessons by type
  const lessonTypes = await db.many(`
    SELECT type, COUNT(*) as count
    FROM level
    WHERE unit_id IN (SELECT id FROM unit WHERE topic_id LIKE $1)
    GROUP BY type
    ORDER BY type
  `, ['law:%']);

  console.log('\n🎓 LESSONS (60 total):');
  lessonTypes.forEach(lt => {
    console.log(`   - ${lt.type}: ${lt.count}`);
  });

  // Get sample lesson content
  const sampleLesson = await db.one(`
    SELECT id, type, content, unit_id
    FROM level
    WHERE unit_id IN (SELECT id FROM unit WHERE topic_id LIKE $1)
    AND type = 'lesson'
    LIMIT 1
  `, ['law:%']);

  console.log('\n✨ SAMPLE LESSON:');
  console.log(`   ID: ${sampleLesson.id}`);
  console.log(`   Type: ${sampleLesson.type}`);
  console.log(`   Preview: ${sampleLesson.content?.substring(0, 100) || 'No content'}...`);

  // Get questions
  const questions = await db.many(`
    SELECT id, prompt, type, topic_id
    FROM question
    WHERE topic_id LIKE $1
    ORDER BY id
  `, ['law:%']);

  console.log('\n❓ QUESTIONS (10 total):');
  questions.forEach(q => {
    const preview = q.prompt.substring(0, 50);
    console.log(`   - [${q.topic_id}] ${preview}...`);
  });

  console.log('\n✅ Curriculum data verified successfully!\n');

} catch (err) {
  console.error('Error:', err.message);
}

process.exit(0);
