import { io } from 'socket.io-client';
import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://localhost:3001';

async function testFullFlow() {
  console.log('\n🧪 Starting End-to-End Flow Test\n');

  try {
    // 1. Create teacher account
    console.log('1️⃣  Creating teacher account...');
    const teacherRes = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'Teacher',
        email: `teacher-${Date.now()}@test.com`,
        password: 'password123',
        role: 'teacher'
      })
    });
    const teacher = await teacherRes.json();
    console.log(`   ✅ Teacher created: ${teacher.firstName} ${teacher.lastName} (ID: ${teacher.id})`);
    console.log(`   📧 Email: ${teacher.email}`);
    console.log(`   🎭 Role: ${teacher.role}`);

    // 2. Create class
    console.log('\n2️⃣  Creating class...');
    const classRes = await fetch(`${API_URL}/api/classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacherId: teacher.id,
        year_level: 7,
        class_identifier: 'A',
        subject: 'French'
      })
    });
    const classData = await classRes.json();
    console.log(`   ✅ Class created: ${classData.name}`);
    console.log(`   🔑 Join Code: ${classData.code}`);
    console.log(`   💬 Room ID: ${classData.roomId}`);

    // 3. Join class as student
    console.log('\n3️⃣  Joining class as student...');
    const joinRes = await fetch(`${API_URL}/api/classes/join/${classData.code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'Student',
        email: `student-${Date.now()}@test.com`,
        password: 'password123'
      })
    });
    const joinResult = await joinRes.json();
    const student = joinResult.student;
    console.log(`   ✅ Student joined: ${student.firstName} ${student.lastName} (ID: ${student.id})`);
    console.log(`   📧 Email: ${student.email}`);
    console.log(`   🎭 Role: ${student.role}`);

    // 4. Verify student appears in class
    console.log('\n4️⃣  Verifying student appears in teacher dashboard...');
    const studentsRes = await fetch(`${API_URL}/api/classes/${classData.id}/students`);
    const students = await studentsRes.json();
    console.log(`   ✅ Students in class: ${students.length}`);
    students.forEach(s => {
      console.log(`      - ${s.firstName} ${s.lastName} (${s.email})`);
    });

    // 5. Test socket connection and message sending
    console.log('\n5️⃣  Testing socket.io chat...');

    return new Promise((resolve, reject) => {
      const socket = io('http://localhost:3001');

      socket.on('connect', () => {
        console.log('   ✅ Socket connected');

        // Join room
        socket.emit('join_room', {
          roomId: classData.roomId,
          userId: student.id,
          userName: `${student.firstName} ${student.lastName}`
        });

        console.log(`   📨 Joining room ${classData.roomId}...`);
      });

      socket.on('student_message', (message) => {
        console.log(`   ✅ Student message received: "${message.raw_text}"`);
        console.log(`   📊 Analysis:`, message.analysis);
      });

      socket.on('ai_message', (message) => {
        console.log(`   ✅ AI response received: "${message.raw_text}"`);
        console.log(`   🎯 Intent: ${message.pedagogical_intent}`);

        socket.disconnect();
        console.log('\n✨ All tests passed!\n');
        resolve();
      });

      socket.on('error', (error) => {
        console.error(`   ❌ Socket error: ${error.message}`);
        socket.disconnect();
        reject(error);
      });

      // Send a test message after joining
      setTimeout(() => {
        console.log('   📤 Sending test message: "Bonjour, comment allez-vous?"');
        socket.emit('send_message', {
          roomId: classData.roomId,
          content: 'Bonjour, comment allez-vous?',
          targetLanguage: 'fr'
        });
      }, 1000);
    });

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response:', await error.response.text());
    }
    process.exit(1);
  }
}

testFullFlow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
