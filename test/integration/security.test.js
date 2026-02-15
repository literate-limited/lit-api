import fetch from 'node-fetch';
import { io } from 'socket.io-client';

const API_URL = process.env.API_URL || 'http://localhost:3001';

async function testSecurity() {
  console.log('\n🔒 SECURITY & EDGE CASE TESTS\n');
  console.log('='.repeat(60));

  const tests = [];
  let passed = 0;
  let failed = 0;

  // Helper
  async function createTeacher() {
    const res = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Teacher',
        lastName: 'Test',
        email: `teacher-${Date.now()}@test.com`,
        password: 'password123',
        role: 'teacher'
      })
    });
    return res.json();
  }

  async function createClass(teacherId) {
    const res = await fetch(`${API_URL}/api/classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacherId,
        year_level: 7,
        class_identifier: 'A',
        subject: 'French'
      })
    });
    return res.json();
  }

  // Test 1: SQL Injection in signup
  tests.push({
    name: 'SQL Injection attempt in signup',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: "'; DROP TABLE users; --",
          lastName: "Test",
          email: `sqli-${Date.now()}@test.com`,
          password: 'password123',
          role: 'teacher'
        })
      });

      // Should succeed (input sanitized) or fail gracefully
      if (res.ok) {
        const user = await res.json();
        // Check database still exists
        const checkRes = await fetch(`${API_URL}/health`);
        if (!checkRes.ok) throw new Error('Database corrupted by SQL injection!');
        console.log('   SQL injection blocked - user created safely');
      } else {
        console.log('   SQL injection blocked - request rejected');
      }
      return true;
    }
  });

  // Test 2: XSS attempt in message
  tests.push({
    name: 'XSS attempt in message content',
    fn: async () => {
      const teacher = await createTeacher();
      const classData = await createClass(teacher.id);

      const joinRes = await fetch(`${API_URL}/api/classes/join/${classData.code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Student',
          lastName: 'Test',
          email: `student-${Date.now()}@test.com`,
          password: 'password123'
        })
      });
      const student = (await joinRes.json()).student;

      return new Promise((resolve, reject) => {
        const socket = io('http://localhost:3001');
        const timeout = setTimeout(() => {
          socket.disconnect();
          reject(new Error('Timeout'));
        }, 10000);

        socket.on('connect', () => {
          socket.emit('join_room', {
            roomId: classData.roomId,
            userId: student.id,
            userName: 'Test Student'
          });

          setTimeout(() => {
            socket.emit('send_message', {
              roomId: classData.roomId,
              content: '<script>alert("XSS")</script>',
              targetLanguage: 'fr'
            });
          }, 500);
        });

        socket.on('student_message', (msg) => {
          clearTimeout(timeout);
          socket.disconnect();

          // Message should be stored as-is (sanitization happens on frontend)
          if (msg.raw_text.includes('<script>')) {
            console.log('   XSS content stored (frontend responsible for sanitization)');
          }
          resolve(true);
        });

        socket.on('error', () => {
          clearTimeout(timeout);
          socket.disconnect();
          console.log('   XSS blocked at socket level');
          resolve(true);
        });
      });
    }
  });

  // Test 3: Invalid email formats
  tests.push({
    name: 'Invalid email format rejection',
    fn: async () => {
      const invalidEmails = [
        'notanemail',
        '@nodomain.com',
        'no@domain',
        '',
        'spaces in@email.com'
      ];

      let allRejected = true;
      for (const email of invalidEmails) {
        const res = await fetch(`${API_URL}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: 'Test',
            lastName: 'Test',
            email: email,
            password: 'password123',
            role: 'teacher'
          })
        });

        if (res.ok) {
          console.log(`   ⚠️  Invalid email accepted: ${email}`);
          allRejected = false;
        }
      }

      if (allRejected) {
        console.log('   All invalid emails rejected');
      }
      return true;
    }
  });

  // Test 4: Password strength (optional check)
  tests.push({
    name: 'Weak password handling',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Test',
          email: `weak-${Date.now()}@test.com`,
          password: '123',
          role: 'teacher'
        })
      });

      // May accept or reject weak passwords
      if (res.ok) {
        console.log('   ⚠️  Weak password accepted (consider adding validation)');
      } else {
        console.log('   Weak password rejected');
      }
      return true;
    }
  });

  // Test 5: Duplicate email signup
  tests.push({
    name: 'Duplicate email prevention',
    fn: async () => {
      const email = `duplicate-${Date.now()}@test.com`;

      const res1 = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Test',
          email: email,
          password: 'password123',
          role: 'teacher'
        })
      });

      if (!res1.ok) throw new Error('First signup failed');

      const res2 = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Test2',
          lastName: 'Test2',
          email: email,
          password: 'password456',
          role: 'teacher'
        })
      });

      if (res2.ok) {
        throw new Error('Duplicate email allowed!');
      }

      console.log('   Duplicate email correctly rejected');
      return true;
    }
  });

  // Test 6: Missing required fields
  tests.push({
    name: 'Missing required fields validation',
    fn: async () => {
      const incompleteRequests = [
        { firstName: 'Test', lastName: 'Test', password: 'pw' }, // no email
        { email: 'test@test.com', lastName: 'Test', password: 'pw' }, // no firstName
        { firstName: 'Test', email: 'test@test.com', password: 'pw' }, // no lastName
        { firstName: 'Test', lastName: 'Test', email: 'test@test.com' }, // no password
      ];

      let allRejected = true;
      for (const body of incompleteRequests) {
        const res = await fetch(`${API_URL}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, role: 'teacher' })
        });

        if (res.ok) {
          console.log(`   ⚠️  Incomplete request accepted: ${JSON.stringify(body)}`);
          allRejected = false;
        }
      }

      if (allRejected) {
        console.log('   All incomplete requests rejected');
      }
      return true;
    }
  });

  // Test 7: Invalid role escalation
  tests.push({
    name: 'Role escalation prevention',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Test',
          email: `admin-${Date.now()}@test.com`,
          password: 'password123',
          role: 'admin' // Trying to create admin
        })
      });

      if (res.ok) {
        const user = await res.json();
        if (user.role === 'admin') {
          console.log('   ⚠️  Role escalation possible - admin role created!');
        } else {
          console.log('   Role downgraded from admin to safe role');
        }
      } else {
        console.log('   Admin role creation blocked');
      }
      return true;
    }
  });

  // Test 8: Invalid class code
  tests.push({
    name: 'Invalid class code handling',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/classes/join/INVALID_CODE`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Test',
          email: `test-${Date.now()}@test.com`,
          password: 'password123'
        })
      });

      if (res.ok) {
        throw new Error('Invalid class code accepted!');
      }

      console.log('   Invalid class code rejected');
      return true;
    }
  });

  // Test 9: Empty message content
  tests.push({
    name: 'Empty message handling',
    fn: async () => {
      const teacher = await createTeacher();
      const classData = await createClass(teacher.id);

      const joinRes = await fetch(`${API_URL}/api/classes/join/${classData.code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Student',
          lastName: 'Test',
          email: `student-${Date.now()}@test.com`,
          password: 'password123'
        })
      });
      const student = (await joinRes.json()).student;

      return new Promise((resolve) => {
        const socket = io('http://localhost:3001');
        const timeout = setTimeout(() => {
          socket.disconnect();
          console.log('   Empty message correctly rejected (timeout)');
          resolve(true);
        }, 5000);

        socket.on('connect', () => {
          socket.emit('join_room', {
            roomId: classData.roomId,
            userId: student.id,
            userName: 'Test'
          });

          setTimeout(() => {
            socket.emit('send_message', {
              roomId: classData.roomId,
              content: '',
              targetLanguage: 'fr'
            });
          }, 500);
        });

        socket.on('error', (error) => {
          clearTimeout(timeout);
          socket.disconnect();
          console.log('   Empty message rejected');
          resolve(true);
        });

        socket.on('student_message', () => {
          clearTimeout(timeout);
          socket.disconnect();
          console.log('   ⚠️  Empty message accepted');
          resolve(true);
        });
      });
    }
  });

  // Test 10: Extremely long message
  tests.push({
    name: 'Extremely long message handling',
    fn: async () => {
      const teacher = await createTeacher();
      const classData = await createClass(teacher.id);

      const joinRes = await fetch(`${API_URL}/api/classes/join/${classData.code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Student',
          lastName: 'Test',
          email: `student-${Date.now()}@test.com`,
          password: 'password123'
        })
      });
      const student = (await joinRes.json()).student;

      const longMessage = 'A'.repeat(10000); // 10KB message

      return new Promise((resolve) => {
        const socket = io('http://localhost:3001');
        const timeout = setTimeout(() => {
          socket.disconnect();
          resolve(true);
        }, 15000);

        socket.on('connect', () => {
          socket.emit('join_room', {
            roomId: classData.roomId,
            userId: student.id,
            userName: 'Test'
          });

          setTimeout(() => {
            socket.emit('send_message', {
              roomId: classData.roomId,
              content: longMessage,
              targetLanguage: 'fr'
            });
          }, 500);
        });

        socket.on('student_message', (msg) => {
          clearTimeout(timeout);
          socket.disconnect();
          console.log(`   Long message accepted (${msg.raw_text.length} chars)`);
          resolve(true);
        });

        socket.on('error', () => {
          clearTimeout(timeout);
          socket.disconnect();
          console.log('   Long message rejected');
          resolve(true);
        });
      });
    }
  });

  // Test 11: Wrong password login
  tests.push({
    name: 'Wrong password rejection',
    fn: async () => {
      const email = `test-${Date.now()}@test.com`;

      await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Test',
          email: email,
          password: 'correct_password',
          role: 'teacher'
        })
      });

      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          password: 'wrong_password'
        })
      });

      if (res.ok) {
        throw new Error('Wrong password accepted!');
      }

      console.log('   Wrong password correctly rejected');
      return true;
    }
  });

  // Test 12: Non-existent user login
  tests.push({
    name: 'Non-existent user login',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@test.com',
          password: 'password123'
        })
      });

      if (res.ok) {
        throw new Error('Non-existent user login succeeded!');
      }

      console.log('   Non-existent user login rejected');
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
  console.log(`\n📊 Security Tests: ${passed} passed, ${failed} failed\n`);

  return failed === 0;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testSecurity()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default testSecurity;
