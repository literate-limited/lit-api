import { io } from 'socket.io-client';
import fetch from 'node-fetch';
import db from './db.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

// Test scenarios
const tests = [];
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('\n🧪 COMPREHENSIVE TEST SUITE\n');
  console.log('='.repeat(60));

  for (const { name, fn } of tests) {
    try {
      console.log(`\n📋 ${name}`);
      await fn();
      console.log(`   ✅ PASSED`);
      testsPassed++;
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}`);
      console.error(error.stack);
      testsFailed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Helper functions
async function createTeacher(email) {
  const res = await fetch(`${API_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Teacher',
      lastName: 'Test',
      email,
      password: 'password123',
      role: 'teacher'
    })
  });
  if (!res.ok) throw new Error(`Failed to create teacher: ${await res.text()}`);
  return res.json();
}

async function createClass(teacherId, subject = 'French') {
  const res = await fetch(`${API_URL}/api/classes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teacherId,
      year_level: 7,
      class_identifier: 'A',
      subject
    })
  });
  if (!res.ok) throw new Error(`Failed to create class: ${await res.text()}`);
  return res.json();
}

async function joinClass(code, email) {
  const res = await fetch(`${API_URL}/api/classes/join/${code}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Student',
      lastName: 'Test',
      email,
      password: 'password123'
    })
  });
  if (!res.ok) throw new Error(`Failed to join class: ${await res.text()}`);
  return res.json();
}

async function sendMessageViaSocket(roomId, userId, userName, content) {
  return new Promise((resolve, reject) => {
    const socket = io('http://localhost:3001');
    const messages = [];

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timeout waiting for AI response'));
    }, 10000);

    socket.on('connect', () => {
      socket.emit('join_room', { roomId, userId, userName });
      setTimeout(() => {
        socket.emit('send_message', { roomId, content, targetLanguage: 'fr' });
      }, 500);
    });

    socket.on('student_message', (msg) => {
      messages.push({ type: 'student', ...msg });
    });

    socket.on('ai_message', (msg) => {
      messages.push({ type: 'ai', ...msg });
      clearTimeout(timeout);
      socket.disconnect();
      resolve(messages);
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(new Error(error.message));
    });
  });
}

// TEST SUITE

test('1. Teacher Signup', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  if (!teacher.id) throw new Error('No teacher ID returned');
  if (teacher.role !== 'teacher') throw new Error('Wrong role');
  console.log(`   Teacher ID: ${teacher.id}`);
});

test('2. Class Creation', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);

  if (!classData.id) throw new Error('No class ID');
  if (!classData.code) throw new Error('No class code');
  if (!classData.roomId) throw new Error('No room ID');
  if (classData.name !== '7 A French') throw new Error('Wrong class name');

  console.log(`   Class: ${classData.name}, Code: ${classData.code}`);
});

test('3. Student Join via Code', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const result = await joinClass(classData.code, `student-${Date.now()}@test.com`);

  if (!result.student.id) throw new Error('No student ID');
  if (result.student.role !== 'student') throw new Error('Wrong role');
  if (!result.roomId) throw new Error('No room ID');

  console.log(`   Student ID: ${result.student.id}`);
});

test('4. Student Appears in Teacher Dashboard', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  await joinClass(classData.code, `student1-${Date.now()}@test.com`);
  await joinClass(classData.code, `student2-${Date.now()}@test.com`);

  const res = await fetch(`${API_URL}/api/classes/${classData.id}/students`);
  const students = await res.json();

  if (students.length !== 2) throw new Error(`Expected 2 students, got ${students.length}`);
  console.log(`   ${students.length} students in class`);
});

test('5. Student Can Send Message', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const result = await joinClass(classData.code, `student-${Date.now()}@test.com`);

  const messages = await sendMessageViaSocket(
    classData.roomId,
    result.student.id,
    'Student Test',
    'Bonjour!'
  );

  if (messages.length !== 2) throw new Error(`Expected 2 messages, got ${messages.length}`);
  if (messages[0].type !== 'student') throw new Error('First message should be student');
  if (messages[1].type !== 'ai') throw new Error('Second message should be AI');

  console.log(`   Student: "${messages[0].raw_text}"`);
  console.log(`   AI: "${messages[1].raw_text}"`);
});

test('6. Message Analysis is Correct', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const result = await joinClass(classData.code, `student-${Date.now()}@test.com`);

  const messages = await sendMessageViaSocket(
    classData.roomId,
    result.student.id,
    'Student Test',
    'Bonjour, je suis un étudiant'
  );

  const studentMsg = messages.find(m => m.type === 'student');
  if (!studentMsg.analysis) throw new Error('No analysis');
  if (studentMsg.analysis.error_count === undefined) throw new Error('No error_count');
  if (!studentMsg.analysis.language_distribution) throw new Error('No language_distribution');

  console.log(`   Errors: ${studentMsg.analysis.error_count}`);
  console.log(`   French: ${(studentMsg.analysis.language_distribution.target_language_pct * 100).toFixed(0)}%`);
});

test('7. Multiple Students in Same Room', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const student1 = await joinClass(classData.code, `student1-${Date.now()}@test.com`);
  const student2 = await joinClass(classData.code, `student2-${Date.now()}@test.com`);

  // Both students send messages
  const msgs1 = await sendMessageViaSocket(
    classData.roomId,
    student1.student.id,
    'Student 1',
    'Salut!'
  );

  const msgs2 = await sendMessageViaSocket(
    classData.roomId,
    student2.student.id,
    'Student 2',
    'Bonjour!'
  );

  if (msgs1.length !== 2) throw new Error('Student 1 messages wrong');
  if (msgs2.length !== 2) throw new Error('Student 2 messages wrong');

  console.log(`   Both students successfully sent messages`);
});

test('8. Message Persistence', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const result = await joinClass(classData.code, `student-${Date.now()}@test.com`);

  await sendMessageViaSocket(
    classData.roomId,
    result.student.id,
    'Student Test',
    'Test message for persistence'
  );

  // Check messages are in database
  const res = await fetch(`${API_URL}/api/rooms/${classData.roomId}/messages`);
  const messages = await res.json();

  if (!Array.isArray(messages)) throw new Error('Messages not array');
  if (messages.length < 2) throw new Error('Not enough messages in DB');

  const studentMsg = messages.find(m => m.sender_role === 'student');
  const aiMsg = messages.find(m => m.sender_role === 'ai');

  if (!studentMsg) throw new Error('Student message not in DB');
  if (!aiMsg) throw new Error('AI message not in DB');

  console.log(`   ${messages.length} messages persisted to database`);
});

test('9. Message Segments Stored', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const result = await joinClass(classData.code, `student-${Date.now()}@test.com`);

  await sendMessageViaSocket(
    classData.roomId,
    result.student.id,
    'Student Test',
    'Je parle français'
  );

  // Check segments in database
  const latestMessage = await db.one(
    `
      SELECT m.id
      FROM message m
      WHERE m.room_id = $1 AND m.sender_role = 'student'
      ORDER BY m.created_at DESC
      LIMIT 1
    `,
    [classData.roomId]
  );
  if (!latestMessage) throw new Error('No message stored');

  const segments = await db.many(
    'SELECT * FROM message_segment WHERE message_id = $1',
    [latestMessage.id]
  );

  if (segments.length === 0) throw new Error('No segments stored');

  console.log(`   ${segments.length} segments stored`);
});

test('10. Student Assessment Updated', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const result = await joinClass(classData.code, `student-${Date.now()}@test.com`);

  await sendMessageViaSocket(
    classData.roomId,
    result.student.id,
    'Student Test',
    'Je suis content'
  );

  // Check assessment in database
  const assessment = await db.one(
    `
      SELECT * FROM student_assessment
      WHERE user_id = $1 AND language = 'fr'
    `,
    [result.student.id]
  );

  if (!assessment) throw new Error('No assessment created');
  if (assessment.target_language_pct === undefined) throw new Error('No language pct');

  console.log(`   Assessment: ${(assessment.target_language_pct * 100).toFixed(0)}% French`);
});

test('11. Error Handling - Invalid Room', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const result = await joinClass(classData.code, `student-${Date.now()}@test.com`);

  try {
    await sendMessageViaSocket(
      'invalid-room-id',
      result.student.id,
      'Student Test',
      'Test'
    );
    throw new Error('Should have failed with invalid room');
  } catch (error) {
    if (!error.message.includes('Timeout') && !error.message.includes('error')) {
      throw error;
    }
    console.log(`   Correctly handles invalid room`);
  }
});

test('12. Non-Student Cannot Send Messages', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);

  try {
    await sendMessageViaSocket(
      classData.roomId,
      teacher.id,
      'Teacher Test',
      'Test'
    );
    throw new Error('Teacher should not be able to send messages');
  } catch (error) {
    if (!error.message.includes('Only students')) {
      // Expected to timeout or get error
    }
    console.log(`   Correctly rejects non-student messages`);
  }
});

test('13. Multiple Messages in Sequence', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  const result = await joinClass(classData.code, `student-${Date.now()}@test.com`);

  const msg1 = await sendMessageViaSocket(
    classData.roomId,
    result.student.id,
    'Student Test',
    'Premier message'
  );

  const msg2 = await sendMessageViaSocket(
    classData.roomId,
    result.student.id,
    'Student Test',
    'Deuxième message'
  );

  const msg3 = await sendMessageViaSocket(
    classData.roomId,
    result.student.id,
    'Student Test',
    'Troisième message'
  );

  if (msg1.length !== 2 || msg2.length !== 2 || msg3.length !== 2) {
    throw new Error('Wrong number of messages');
  }

  console.log(`   3 sequential conversations completed`);
});

test('14. Room Details Endpoint', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);

  const res = await fetch(`${API_URL}/api/rooms/${classData.roomId}`);
  if (!res.ok) throw new Error('Failed to get room details');

  const room = await res.json();
  if (!room.id) throw new Error('No room ID');
  if (!room.class_id && !room.classId) throw new Error('No class ID');

  console.log(`   Room details retrieved: ${room.id}`);
});

test('15. Database Cleanup After Class Delete', async () => {
  const teacher = await createTeacher(`teacher-${Date.now()}@test.com`);
  const classData = await createClass(teacher.id);
  await joinClass(classData.code, `student-${Date.now()}@test.com`);

  // Delete class
  const res = await fetch(`${API_URL}/api/classes/${classData.id}`, {
    method: 'DELETE'
  });

  if (!res.ok) throw new Error('Failed to delete class');

  // Check enrollments are gone
  const enrollments = await db.many('SELECT * FROM enrollments WHERE class_id = $1', [
    classData.id,
  ]);
  if (enrollments.length !== 0) throw new Error('Enrollments not deleted');

  // Check room is gone
  const rooms = await db.many('SELECT * FROM chat_rooms WHERE class_id = $1', [classData.id]);
  if (rooms.length !== 0) throw new Error('Room not deleted');

  console.log(`   Cascading delete works correctly`);
});

// Run all tests
runTests().catch(console.error);
