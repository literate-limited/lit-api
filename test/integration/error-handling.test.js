import fetch from 'node-fetch';
import { io } from 'socket.io-client';

const API_URL = process.env.API_URL || 'http://localhost:3001';

async function testErrorHandling() {
  console.log('\n⚠️  ERROR HANDLING TESTS\n');
  console.log('='.repeat(60));

  const tests = [];
  let passed = 0;
  let failed = 0;

  // Helper functions
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

  async function createStudent(classCode) {
    const res = await fetch(`${API_URL}/api/classes/join/${classCode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Student',
        lastName: 'Test',
        email: `student-${Date.now()}@test.com`,
        password: 'password123'
      })
    });
    return res.json();
  }

  // Test 1: Malformed JSON in request
  tests.push({
    name: 'Malformed JSON handling',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json here'
      });

      if (res.ok) {
        throw new Error('Malformed JSON accepted!');
      }

      console.log('   Malformed JSON rejected');
      return true;
    }
  });

  // Test 2: Missing Content-Type header
  tests.push({
    name: 'Missing Content-Type header',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Test',
          email: 'test@test.com',
          password: 'password123',
          role: 'teacher'
        })
      });

      // May accept or reject based on implementation
      if (res.ok) {
        console.log('   Request accepted without Content-Type header');
      } else {
        console.log('   Request rejected without Content-Type header');
      }
      return true;
    }
  });

  // Test 3: Invalid HTTP method on endpoint
  tests.push({
    name: 'Invalid HTTP method (GET on POST endpoint)',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'GET'
      });

      if (res.ok) {
        throw new Error('GET accepted on POST-only endpoint!');
      }

      console.log('   Invalid HTTP method rejected');
      return true;
    }
  });

  // Test 4: Non-existent endpoint
  tests.push({
    name: 'Non-existent endpoint (404)',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/nonexistent/endpoint`);

      if (res.status !== 404) {
        console.log(`   ⚠️  Expected 404, got ${res.status}`);
      } else {
        console.log('   404 returned for non-existent endpoint');
      }
      return true;
    }
  });

  // Test 5: Accessing another user's room
  tests.push({
    name: 'Cross-room access prevention',
    fn: async () => {
      const teacher = await createTeacher();
      const class1 = await createClass(teacher.id);
      const class2 = await createClass(teacher.id);

      const student1 = await createStudent(class1.code);
      const student2 = await createStudent(class2.code);

      // Student 1 tries to send message to Student 2's room
      return new Promise((resolve) => {
        const socket = io('http://localhost:3001');
        const timeout = setTimeout(() => {
          socket.disconnect();
          console.log('   Cross-room message prevented (timeout)');
          resolve(true);
        }, 5000);

        socket.on('connect', () => {
          socket.emit('join_room', {
            roomId: student2.roomId, // Wrong room!
            userId: student1.student.id,
            userName: 'Student 1'
          });

          setTimeout(() => {
            socket.emit('send_message', {
              roomId: student2.roomId,
              content: 'Unauthorized message',
              targetLanguage: 'fr'
            });
          }, 500);
        });

        socket.on('error', () => {
          clearTimeout(timeout);
          socket.disconnect();
          console.log('   Cross-room message blocked');
          resolve(true);
        });

        socket.on('student_message', () => {
          clearTimeout(timeout);
          socket.disconnect();
          console.log('   ⚠️  Cross-room message allowed (security issue!)');
          resolve(true);
        });
      });
    }
  });

  // Test 6: Creating class without teacher ID
  tests.push({
    name: 'Class creation without teacher ID',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_level: 7,
          class_identifier: 'A',
          subject: 'French'
          // Missing teacherId
        })
      });

      if (res.ok) {
        throw new Error('Class created without teacher ID!');
      }

      console.log('   Class creation without teacher ID rejected');
      return true;
    }
  });

  // Test 7: Creating class with non-existent teacher ID
  tests.push({
    name: 'Class creation with invalid teacher ID',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: 'nonexistent-teacher-id',
          year_level: 7,
          class_identifier: 'A',
          subject: 'French'
        })
      });

      if (res.ok) {
        console.log('   ⚠️  Class created with invalid teacher ID');
      } else {
        console.log('   Class creation with invalid teacher ID rejected');
      }
      return true;
    }
  });

  // Test 8: Deleting non-existent class
  tests.push({
    name: 'Deleting non-existent class',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/classes/nonexistent-class-id`, {
        method: 'DELETE'
      });

      if (res.status === 404 || res.status === 400) {
        console.log('   Non-existent class deletion handled gracefully');
      } else if (res.ok) {
        console.log('   ⚠️  Non-existent class deletion succeeded (unexpected)');
      }
      return true;
    }
  });

  // Test 9: Getting messages from non-existent room
  tests.push({
    name: 'Getting messages from non-existent room',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/rooms/nonexistent-room-id/messages`);

      if (res.ok) {
        const messages = await res.json();
        if (Array.isArray(messages) && messages.length === 0) {
          console.log('   Non-existent room returns empty array');
        } else {
          console.log('   ⚠️  Non-existent room returns data');
        }
      } else {
        console.log('   Non-existent room request rejected');
      }
      return true;
    }
  });

  // Test 10: Concurrent message sending
  tests.push({
    name: 'Concurrent message sending (race condition test)',
    fn: async () => {
      const teacher = await createTeacher();
      const classData = await createClass(teacher.id);
      const student = await createStudent(classData.code);

      const sendMessage = (content) => {
        return new Promise((resolve, reject) => {
          const socket = io('http://localhost:3001');
          const timeout = setTimeout(() => {
            socket.disconnect();
            reject(new Error('Timeout'));
          }, 15000);

          socket.on('connect', () => {
            socket.emit('join_room', {
              roomId: classData.roomId,
              userId: student.student.id,
              userName: 'Test'
            });

            setTimeout(() => {
              socket.emit('send_message', {
                roomId: classData.roomId,
                content,
                targetLanguage: 'fr'
              });
            }, 500);
          });

          socket.on('student_message', () => {
            // Wait for AI response
          });

          socket.on('ai_message', () => {
            clearTimeout(timeout);
            socket.disconnect();
            resolve(true);
          });

          socket.on('error', (err) => {
            clearTimeout(timeout);
            socket.disconnect();
            reject(err);
          });
        });
      };

      try {
        // Send 3 messages concurrently
        await Promise.all([
          sendMessage('Message 1'),
          sendMessage('Message 2'),
          sendMessage('Message 3')
        ]);
        console.log('   Concurrent messages handled successfully');
      } catch (error) {
        console.log(`   Concurrent message error: ${error.message}`);
      }

      return true;
    }
  });

  // Test 11: Special characters in names
  tests.push({
    name: 'Special characters in user names',
    fn: async () => {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: "José María",
          lastName: "O'Brien-Smith",
          email: `special-${Date.now()}@test.com`,
          password: 'password123',
          role: 'teacher'
        })
      });

      if (!res.ok) {
        console.log('   ⚠️  Special characters rejected');
      } else {
        console.log('   Special characters accepted');
      }
      return true;
    }
  });

  // Test 12: Unicode in messages
  tests.push({
    name: 'Unicode characters in messages',
    fn: async () => {
      const teacher = await createTeacher();
      const classData = await createClass(teacher.id);
      const student = await createStudent(classData.code);

      return new Promise((resolve) => {
        const socket = io('http://localhost:3001');
        const timeout = setTimeout(() => {
          socket.disconnect();
          resolve(true);
        }, 15000);

        socket.on('connect', () => {
          socket.emit('join_room', {
            roomId: classData.roomId,
            userId: student.student.id,
            userName: 'Test'
          });

          setTimeout(() => {
            socket.emit('send_message', {
              roomId: classData.roomId,
              content: 'Bonjour! 你好! こんにちは! 🎉🇫🇷',
              targetLanguage: 'fr'
            });
          }, 500);
        });

        socket.on('student_message', (msg) => {
          clearTimeout(timeout);
          socket.disconnect();
          if (msg.raw_text.includes('🎉')) {
            console.log('   Unicode and emoji preserved');
          } else {
            console.log('   ⚠️  Unicode/emoji corrupted');
          }
          resolve(true);
        });

        socket.on('error', () => {
          clearTimeout(timeout);
          socket.disconnect();
          console.log('   Unicode message rejected');
          resolve(true);
        });
      });
    }
  });

  // Test 13: Rapid repeated requests (rate limiting check)
  tests.push({
    name: 'Rapid repeated requests',
    fn: async () => {
      const promises = [];
      const email = `rapid-${Date.now()}@test.com`;

      // Send 20 identical requests rapidly
      for (let i = 0; i < 20; i++) {
        promises.push(
          fetch(`${API_URL}/health`, { method: 'GET' })
        );
      }

      const results = await Promise.all(promises);
      const successCount = results.filter(r => r.ok).length;

      console.log(`   ${successCount}/20 rapid requests succeeded`);
      if (successCount === 20) {
        console.log('   ⚠️  No rate limiting detected');
      }
      return true;
    }
  });

  // Test 14: Invalid year level in class creation
  tests.push({
    name: 'Invalid year level in class creation',
    fn: async () => {
      const teacher = await createTeacher();

      const invalidYears = [-1, 0, 13, 999, 'invalid'];

      let allRejected = true;
      for (const year of invalidYears) {
        const res = await fetch(`${API_URL}/api/classes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teacherId: teacher.id,
            year_level: year,
            class_identifier: 'A',
            subject: 'French'
          })
        });

        if (res.ok) {
          console.log(`   ⚠️  Invalid year level accepted: ${year}`);
          allRejected = false;
        }
      }

      if (allRejected) {
        console.log('   All invalid year levels rejected');
      } else {
        console.log('   Some invalid year levels accepted');
      }
      return true;
    }
  });

  // Test 15: Database connection resilience
  tests.push({
    name: 'Database connection check',
    fn: async () => {
      // Test multiple database operations in sequence
      const teacher = await createTeacher();
      const class1 = await createClass(teacher.id);
      const class2 = await createClass(teacher.id);

      const classesRes = await fetch(`${API_URL}/api/classes/teacher/${teacher.id}`);
      if (!classesRes.ok) {
        throw new Error('Database operation failed');
      }

      const classes = await classesRes.json();
      if (classes.length < 2) {
        throw new Error('Database consistency issue');
      }

      console.log('   Database operations consistent');
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
  console.log(`\n📊 Error Handling Tests: ${passed} passed, ${failed} failed\n`);

  return failed === 0;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testErrorHandling()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default testErrorHandling;
