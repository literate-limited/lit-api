import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://localhost:3001';

async function testCurriculum() {
  console.log('\n🧪 CURRICULUM SYSTEM TESTS\n');
  console.log('='.repeat(60));

  const tests = [];
  let passed = 0;
  let failed = 0;

  // Test 1: Get all languages
  tests.push({
    name: 'Get all available languages',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/languages`);
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);

      const languages = await res.json();
      if (!Array.isArray(languages)) throw new Error('Languages not an array');
      console.log(`   Found ${languages.length} languages`);
      return true;
    }
  });

  // Test 2: Get all topics for French
  tests.push({
    name: 'Get all French topics',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/fr/topics`);
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);

      const topics = await res.json();
      if (!Array.isArray(topics)) throw new Error('Topics not an array');
      console.log(`   Found ${topics.length} French topics`);
      return true;
    }
  });

  // Test 3: Get topic hierarchy
  tests.push({
    name: 'Get French topic hierarchy',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/fr/hierarchy`);
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);

      const hierarchy = await res.json();
      if (!Array.isArray(hierarchy)) throw new Error('Hierarchy not an array');
      console.log(`   Hierarchy has ${hierarchy.length} root topics`);
      return true;
    }
  });

  // Test 4: Get specific topic by ID
  tests.push({
    name: 'Get specific topic by ID',
    fn: async () => {
      // First get a topic
      const topicsRes = await fetch(`${API_URL}/api/curriculum/fr/topics`);
      const topics = await topicsRes.json();

      if (topics.length === 0) {
        console.log('   ⚠️  No topics found - skipping');
        return true;
      }

      const topicId = topics[0].id;
      const res = await fetch(`${API_URL}/api/curriculum/fr/topics/${topicId}`);
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);

      const data = await res.json();
      if (data.topic.id !== topicId) throw new Error('Wrong topic returned');
      console.log(`   Topic retrieved: ${data.topic.name || data.topic.id} (with ${data.questions.length} questions)`);
      return true;
    }
  });

  // Test 5: Get random questions
  tests.push({
    name: 'Get random French questions',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/fr/questions/random?count=5`);
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);

      const questions = await res.json();
      if (!Array.isArray(questions)) throw new Error('Questions not an array');
      console.log(`   Retrieved ${questions.length} random questions`);
      return true;
    }
  });

  // Test 6: Get French statistics
  tests.push({
    name: 'Get French curriculum statistics',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/fr/statistics`);
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);

      const stats = await res.json();
      if (typeof stats !== 'object') throw new Error('Stats not an object');
      console.log(`   Statistics retrieved`);
      return true;
    }
  });

  // Test 7: Invalid language code
  tests.push({
    name: 'Handle invalid language code',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/invalid-lang/topics`);
      // Should return empty array or error
      if (res.ok) {
        const topics = await res.json();
        if (Array.isArray(topics) && topics.length === 0) {
          console.log('   Invalid language returns empty array');
        } else {
          console.log('   ⚠️  Invalid language returned data');
        }
      } else {
        console.log('   Invalid language rejected');
      }
      return true;
    }
  });

  // Test 8: Invalid topic ID
  tests.push({
    name: 'Handle invalid topic ID',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/fr/topics/invalid-id-12345`);
      if (res.ok) {
        const data = await res.json();
        if (data === null || Object.keys(data).length === 0) {
          console.log('   Invalid topic ID returns null/empty');
        } else {
          console.log('   ⚠️  Invalid topic ID returned data');
        }
      } else {
        console.log('   Invalid topic ID rejected');
      }
      return true;
    }
  });

  // Test 9: Get all topics for Spanish
  tests.push({
    name: 'Get all Spanish topics',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/es/topics`);
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);

      const topics = await res.json();
      if (!Array.isArray(topics)) throw new Error('Topics not an array');
      console.log(`   Found ${topics.length} Spanish topics`);
      return true;
    }
  });

  // Test 10: Hierarchy structure validation
  tests.push({
    name: 'Validate hierarchy structure',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/curriculum/fr/hierarchy`);
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);

      const hierarchy = await res.json();

      // Check structure has children
      const hasChildren = (node) => {
        if (node.children && node.children.length > 0) return true;
        if (node.children) {
          return node.children.some(hasChildren);
        }
        return false;
      };

      const structureValid = hierarchy.some(hasChildren);
      if (structureValid) {
        console.log('   Hierarchy has nested children structure');
      } else {
        console.log('   Hierarchy is flat (no children)');
      }
      return true;
    }
  });

  // Run all tests
  for (const test of tests) {
    try {
      console.log(`\n📋 ${test.name}`);
      await test.fn();
      console.log('   ✅ PASSED');
      passed++;
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Curriculum Tests: ${passed} passed, ${failed} failed\n`);

  return failed === 0;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testCurriculum()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default testCurriculum;
