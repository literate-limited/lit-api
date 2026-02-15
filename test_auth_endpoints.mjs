import db from './db.js';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const API_URL = 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Helper to make HTTP requests with auth
async function httpGet(url, token = null) {
  try {
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const response = await fetch(url, { headers });
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

async function runAuthTests() {
  console.log('\n=== TESTING AUTHENTICATED LAW ENDPOINTS ===\n');

  try {
    // Step 1: Create or get test user
    console.log('📋 STEP 1: Create test user');
    console.log('─'.repeat(50));

    const testEmail = 'lawtest@example.com';

    // Get law brand ID
    const lawBrand = await db.one('SELECT id FROM brands WHERE code = $1', ['law']);
    console.log(`✅ Law brand ID: ${lawBrand.id}`);

    // Create test user (or get existing)
    let testUserId;
    let coreUserId;
    const existingUser = await db.one(
      `SELECT id, core_user_id FROM users WHERE email = $1`,
      [testEmail]
    );

    if (!existingUser) {
      testUserId = uuidv4();
      coreUserId = uuidv4();

      // First create core user
      await db.query(
        `INSERT INTO core_users (id, email, password_hash, first_name, last_name, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [coreUserId, testEmail, 'test-hash', 'Law', 'Test']
      );

      // Then create brand user
      await db.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, brand_id, core_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [testUserId, testEmail, 'test-hash', 'Law', 'Test', 'student', lawBrand.id, coreUserId]
      );
      console.log(`✅ Test user created: ${testEmail}`);
    } else {
      testUserId = existingUser.id;
      coreUserId = existingUser.core_user_id;
      console.log(`✅ Using existing test user: ${testEmail}`);
    }
    console.log(`   User ID: ${testUserId}`);
    console.log(`   Core User ID: ${coreUserId}`);

    // Step 2: Generate JWT token
    console.log('\n🔑 STEP 2: Generate JWT token');
    console.log('─'.repeat(50));

    const token = jwt.sign(
      {
        userId: testUserId,
        email: testEmail,
        brandId: lawBrand.id
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log(`✅ JWT token generated (${token.substring(0, 20)}...)`);

    // Step 3: Create some test progress data
    console.log('\n📊 STEP 3: Create test progress data');
    console.log('─'.repeat(50));

    // Get first 3 units
    const units = await db.many(
      `SELECT id, topic_id, teaches_topics FROM unit
       WHERE topic_id LIKE 'law:%'
       ORDER BY difficulty_level, unit_order
       LIMIT 3`
    );

    console.log(`Found ${units.length} units for testing`);

    // Mark 2 units as completed
    for (let i = 0; i < 2; i++) {
      const unit = units[i];
      const existing = await db.one(
        `SELECT id FROM unified_student_progress WHERE user_id = $1 AND unit_id = $2`,
        [coreUserId, unit.id]
      );

      if (!existing) {
        await db.query(
          `INSERT INTO unified_student_progress
           (id, brand_id, user_id, app_code, topic_id, unit_id, status, completed_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'law', $4, $5, 'completed', NOW(), NOW(), NOW())`,
          [uuidv4(), lawBrand.id, coreUserId, unit.topic_id, unit.id]
        );
        console.log(`✅ Marked unit as completed: ${unit.id}`);
      } else {
        console.log(`   Unit already tracked: ${unit.id}`);
      }
    }

    // Mark 1 unit as in-progress
    if (units.length > 2) {
      const existing = await db.one(
        `SELECT id FROM unified_student_progress WHERE user_id = $1 AND unit_id = $2`,
        [coreUserId, units[2].id]
      );

      if (!existing) {
        await db.query(
          `INSERT INTO unified_student_progress
           (id, brand_id, user_id, app_code, topic_id, unit_id, status, last_attempted_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'law', $4, $5, 'in_progress', NOW(), NOW(), NOW())`,
          [uuidv4(), lawBrand.id, coreUserId, units[2].topic_id, units[2].id]
        );
        console.log(`✅ Marked unit as in-progress: ${units[2].id}`);
      } else {
        console.log(`   Unit already tracked: ${units[2].id}`);
      }
    }

    // Step 4: Test authenticated endpoints
    console.log('\n🧪 STEP 4: Test authenticated endpoints');
    console.log('─'.repeat(50));

    // Test 1: GET /api/law/assessment
    console.log('\n📍 GET /api/law/assessment');
    const res1 = await httpGet(`${API_URL}/api/law/assessment`, token);
    if (res1.ok) {
      console.log(`✅ Status: ${res1.status}`);
      console.log(`✅ Competency level: ${res1.data.competency_level}`);
      console.log(`✅ Units completed: ${res1.data.units_completed}/${res1.data.units_total}`);
      console.log(`✅ Completion rate: ${res1.data.completion_rate}%`);
      console.log(`✅ Competency gaps: ${res1.data.competency_gaps?.length || 0} topics`);
      if (res1.data.competency_gaps?.length > 0) {
        console.log(`   Gaps: ${res1.data.competency_gaps.join(', ')}`);
      }
      console.log(`✅ Recommended units: ${res1.data.recommended_units?.length || 0}`);
    } else {
      console.log(`❌ Error: ${res1.status} - ${res1.error}`);
    }

    // Test 2: GET /api/law/assessment/stats
    console.log('\n📍 GET /api/law/assessment/stats');
    const res2 = await httpGet(`${API_URL}/api/law/assessment/stats`, token);
    if (res2.ok) {
      console.log(`✅ Status: ${res2.status}`);
      console.log(`✅ Total units: ${res2.data.total_units}`);
      console.log(`✅ Completed units: ${res2.data.completed_units}`);
      console.log(`✅ In-progress units: ${res2.data.in_progress_units}`);
      console.log(`✅ Completion rate: ${res2.data.completion_rate}%`);
      console.log(`✅ Hours spent: ${res2.data.hours_spent}`);
    } else {
      console.log(`❌ Error: ${res2.status} - ${res2.error}`);
    }

    // Test 3: GET /api/law/assessment/mastery
    console.log('\n📍 GET /api/law/assessment/mastery');
    const res3 = await httpGet(`${API_URL}/api/law/assessment/mastery`, token);
    if (res3.ok) {
      console.log(`✅ Status: ${res3.status}`);
      console.log(`✅ Topic breakdown:`);
      res3.data.forEach(topic => {
        console.log(`   - ${topic.topic_name}: ${topic.mastery_percentage}% (${topic.units_completed}/${topic.units_total} units)`);
      });
    } else {
      console.log(`❌ Error: ${res3.status} - ${res3.error}`);
    }

    // Test 4: GET /api/law/assessment/recommended
    console.log('\n📍 GET /api/law/assessment/recommended');
    const res4 = await httpGet(`${API_URL}/api/law/assessment/recommended`, token);
    if (res4.ok) {
      console.log(`✅ Status: ${res4.status}`);
      console.log(`✅ Recommended units: ${res4.data.recommended?.length || 0}`);
      if (res4.data.recommended && res4.data.recommended.length > 0) {
        res4.data.recommended.slice(0, 3).forEach((rec, i) => {
          console.log(`   ${i + 1}. ${rec.unit_name}`);
          console.log(`      Reason: ${rec.reason}`);
          console.log(`      Difficulty: Level ${rec.difficulty}`);
        });
      }
    } else {
      console.log(`❌ Error: ${res4.status} - ${res4.error}`);
    }

    // Summary
    console.log('\n\n📊 AUTHENTICATED ENDPOINT TEST SUMMARY');
    console.log('═'.repeat(50));
    const results = [res1, res2, res3, res4];
    const passed = results.filter(r => r.ok).length;
    const total = results.length;

    console.log(`\nTests Passed: ${passed}/${total}`);
    console.log(`Coverage: ${Math.round((passed / total) * 100)}%`);

    if (passed === total) {
      console.log('\n✅ ALL AUTHENTICATED ENDPOINTS WORKING!\n');
    } else {
      console.log('\n⚠️  Some endpoints failed. Check errors above.\n');
    }

    // Cleanup option
    console.log('Test user created for future testing:');
    console.log(`  Email: ${testEmail}`);
    console.log(`  User ID: ${testUserId}`);
    console.log(`  Token: ${token.substring(0, 30)}...`);

  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    console.error(error.stack);
  }

  process.exit(0);
}

runAuthTests();
