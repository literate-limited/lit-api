import db from './db.js';

const API_URL = 'http://localhost:3001';

// Helper to make HTTP requests
async function httpGet(url) {
  try {
    const response = await fetch(url);
    return {
      status: response.status,
      ok: response.ok,
      data: response.ok ? await response.json() : null,
      error: response.ok ? null : await response.text()
    };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      data: null,
      error: err.message
    };
  }
}

async function runTests() {
  console.log('\n=== TESTING LAWLORE PHASE 3 ENDPOINTS ===\n');

  try {
    // Test 1: Verify data in database
    console.log('📊 TEST 1: Verify curriculum data in database');
    console.log('─'.repeat(50));

    const topicCount = await db.one('SELECT COUNT(*) as count FROM topic WHERE id LIKE $1', ['law:%']);
    console.log(`✅ Topics created: ${topicCount.count}`);

    const unitCount = await db.one('SELECT COUNT(*) as count FROM unit WHERE topic_id LIKE $1', ['law:%']);
    console.log(`✅ Units created: ${unitCount.count}`);

    const lessonCount = await db.one('SELECT COUNT(*) as count FROM level WHERE unit_id IN (SELECT id FROM unit WHERE topic_id LIKE $1)', ['law:%']);
    console.log(`✅ Lessons created: ${lessonCount.count}`);

    const questionCount = await db.one('SELECT COUNT(*) as count FROM question WHERE topic_id LIKE $1', ['law:%']);
    console.log(`✅ Questions created: ${questionCount.count}`);

    // Sample data
    const sampleTopic = await db.one('SELECT id, name FROM topic WHERE id LIKE $1 LIMIT 1', ['law:%']);
    if (!sampleTopic) {
      console.log('\n⚠️  No law topics found in database. Migration may not have executed.');
      process.exit(0);
    }
    console.log(`\n📌 Sample Topic: ${sampleTopic.id} - ${sampleTopic.name}`);

    const sampleUnit = await db.one('SELECT id, name, topic_id FROM unit WHERE topic_id LIKE $1 LIMIT 1', ['law:%']);
    if (!sampleUnit) {
      console.log('⚠️  No law units found in database.');
      process.exit(0);
    }
    console.log(`📌 Sample Unit: ${sampleUnit.id} - ${sampleUnit.name}`);

    const sampleLesson = await db.one('SELECT id, type, level_order FROM level WHERE unit_id = $1', [sampleUnit.id]);
    if (!sampleLesson) {
      console.log('⚠️  No lessons found for sample unit.');
      process.exit(0);
    }
    console.log(`📌 Sample Lesson: ${sampleLesson.id} - Type: ${sampleLesson.type} (Order: ${sampleLesson.level_order})`);

    const sampleQuestion = await db.one('SELECT id, prompt, type FROM question WHERE topic_id LIKE $1 LIMIT 1', ['law:%']);
    if (sampleQuestion) {
      const promptPreview = sampleQuestion.prompt.length > 50 ? sampleQuestion.prompt.substring(0, 50) + '...' : sampleQuestion.prompt;
      console.log(`📌 Sample Question: ${sampleQuestion.id} - ${promptPreview}`);
    } else {
      console.log(`📌 Sample Question: None found`);
    }

    console.log('\n\n🌐 TEST 2: Test PUBLIC API endpoints');
    console.log('─'.repeat(50));

    // Test 2a: GET /api/law/curriculum
    console.log('\n📍 GET /api/law/curriculum');
    const res2a = await httpGet(`${API_URL}/api/law/curriculum`);
    if (res2a.ok) {
      console.log(`✅ Status: ${res2a.status}`);
      console.log(`✅ Topics returned: ${res2a.data.topics?.length || 0}`);
      if (res2a.data.topics && res2a.data.topics.length > 0) {
        console.log(`   Sample: ${res2a.data.topics[0].id} - ${res2a.data.topics[0].name}`);
      }
    } else {
      console.log(`❌ Error: ${res2a.status} - ${res2a.error}`);
    }

    // Test 2b: GET /api/law/units
    console.log('\n📍 GET /api/law/units');
    const res2b = await httpGet(`${API_URL}/api/law/units`);
    if (res2b.ok) {
      console.log(`✅ Status: ${res2b.status}`);
      console.log(`✅ Units returned: ${res2b.data.units?.length || 0}`);
      if (res2b.data.units && res2b.data.units.length > 0) {
        console.log(`   Sample: ${res2b.data.units[0].id} - ${res2b.data.units[0].name}`);
      }
    } else {
      console.log(`❌ Error: ${res2b.status} - ${res2b.error}`);
    }

    // Test 2c: GET /api/law/units/:unitId
    if (sampleUnit) {
      console.log(`\n📍 GET /api/law/units/${sampleUnit.id}`);
      const res2c = await httpGet(`${API_URL}/api/law/units/${sampleUnit.id}`);
      if (res2c.ok) {
        console.log(`✅ Status: ${res2c.status}`);
        console.log(`✅ Unit: ${res2c.data.unit?.name}`);
        console.log(`✅ Lessons: ${res2c.data.lessons?.length || 0}`);
        if (res2c.data.lessons && res2c.data.lessons.length > 0) {
          console.log(`   Sample lesson: ${res2c.data.lessons[0].type}`);
        }
      } else {
        console.log(`❌ Error: ${res2c.status} - ${res2c.error}`);
      }
    }

    // Test 2d: GET /api/law/lessons/:levelId
    if (sampleLesson) {
      console.log(`\n📍 GET /api/law/lessons/${sampleLesson.id}`);
      const res2d = await httpGet(`${API_URL}/api/law/lessons/${sampleLesson.id}`);
      if (res2d.ok) {
        console.log(`✅ Status: ${res2d.status}`);
        console.log(`✅ Lesson type: ${res2d.data.lesson?.type}`);
        console.log(`✅ Content length: ${res2d.data.lesson?.content?.length || 0} chars`);
      } else {
        console.log(`❌ Error: ${res2d.status} - ${res2d.error}`);
      }
    }

    // Test 2e: GET /api/law/questions/topic/:topicId
    if (sampleTopic) {
      console.log(`\n📍 GET /api/law/questions/topic/${sampleTopic.id}`);
      const res2e = await httpGet(`${API_URL}/api/law/questions/topic/${sampleTopic.id}`);
      if (res2e.ok) {
        console.log(`✅ Status: ${res2e.status}`);
        console.log(`✅ Questions returned: ${res2e.data.questions?.length || 0}`);
        if (res2e.data.questions && res2e.data.questions.length > 0) {
          const qPreview = res2e.data.questions[0].prompt.length > 40 ? res2e.data.questions[0].prompt.substring(0, 40) + '...' : res2e.data.questions[0].prompt;
          console.log(`   Sample: ${qPreview}`);
        }
      } else {
        console.log(`❌ Error: ${res2e.status} - ${res2e.error}`);
      }
    }

    console.log('\n\n🔐 TEST 3: Test AUTHENTICATED endpoints');
    console.log('─'.repeat(50));
    console.log('⚠️  Note: These require a valid auth token\n');

    // For authenticated tests, we'd need a real token
    console.log('📍 GET /api/law/assessment (requires auth token)');
    console.log('   Status: ⏭️  SKIPPED (requires login token)');
    console.log('   Should return: { competency_level, units_completed, units_total, topics_breakdown, competency_gaps, recommended_units }');

    console.log('\n📍 GET /api/law/assessment/stats (requires auth token)');
    console.log('   Status: ⏭️  SKIPPED (requires login token)');
    console.log('   Should return: { total_units, completed_units, in_progress_units, hours_spent, average_score, completion_rate }');

    console.log('\n📍 GET /api/law/assessment/mastery (requires auth token)');
    console.log('   Status: ⏭️  SKIPPED (requires login token)');
    console.log('   Should return: { topic_id, topic_name, mastery_percentage, units_completed, units_total }[]');

    console.log('\n📍 GET /api/law/assessment/recommended (requires auth token)');
    console.log('   Status: ⏭️  SKIPPED (requires login token)');
    console.log('   Should return: { unit_id, unit_name, reason, difficulty, estimated_time }[]');

    console.log('\n\n✅ ENDPOINT TESTING COMPLETE');
    console.log('═'.repeat(50));

  } catch (err) {
    console.error('Fatal error:', err.message);
  }

  process.exit(0);
}

runTests();
