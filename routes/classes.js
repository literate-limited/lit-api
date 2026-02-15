import { Router } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { verifyToken } from '../middleware/auth.js';
import { generateToken } from '../middleware/auth.js';

const router = Router();

// Apply brand resolver to all routes
router.use(brandResolver);

// Generate random 6-digit code
function generateClassCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Create class (teacher only)
router.post('/', async (req, res) => {
  try {
    const { teacherId, year_level, class_identifier, subject } = req.body;

    if (!teacherId || year_level === undefined || !class_identifier || !subject) {
      return res.status(400).json({ error: 'Missing teacherId, year_level, class_identifier, or subject' });
    }

    const classId = uuidv4();
    let code = generateClassCode();

    // Ensure unique code within brand
    while (await db.one('SELECT id FROM classes WHERE code = $1 AND brand_id = $2', [code, req.brandId])) {
      code = generateClassCode();
    }

    const displayName = `${year_level} ${class_identifier} ${subject}`;
    await db.query(
      `
        INSERT INTO classes (id, teacher_id, name, code, year_level, class_identifier, subject, brand_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [classId, teacherId, displayName, code, year_level, class_identifier, subject, req.brandId]
    );

    // Create default chat room for this class
    const roomId = uuidv4();
    await db.query(
      `
        INSERT INTO chat_rooms (id, class_id, type, brand_id)
        VALUES ($1, $2, 'class', $3)
      `,
      [roomId, classId, req.brandId]
    );

    const classData = await db.one('SELECT * FROM classes WHERE id = $1', [classId]);

    res.json({
      ...classData,
      roomId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get class by code
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const classData = await db.one('SELECT * FROM classes WHERE code = $1 AND brand_id = $2', [code, req.brandId]);

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Get room for this class
    const room = await db.one(
      "SELECT * FROM chat_rooms WHERE class_id = $1 AND type = 'class' AND brand_id = $2",
      [classData.id, req.brandId]
    );

    res.json({
      ...classData,
      roomId: room?.id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get teacher's classes
router.get('/teacher/:teacherId', async (req, res) => {
  try {
    const { teacherId } = req.params;

    const classes = await db.many(
      `
        SELECT c.*, cr.id as "roomId"
        FROM classes c
        LEFT JOIN chat_rooms cr ON cr.class_id = c.id AND cr.type = 'class' AND cr.brand_id = $2
        WHERE c.teacher_id = $1 AND c.brand_id = $2
        ORDER BY c.created_at DESC
      `,
      [teacherId, req.brandId]
    );

    res.json(classes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Join class (student onboarding)
router.post('/join/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { firstName, middleName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const classData = await db.one('SELECT * FROM classes WHERE code = $1 AND brand_id = $2', [code, req.brandId]);

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Check if student already exists within this brand
    let student = await db.one('SELECT * FROM users WHERE email = $1 AND brand_id = $2', [
      String(email).toLowerCase().trim(),
      req.brandId
    ]);

    if (!student) {
      // Create new student with hashed password
      const studentId = uuidv4();
      const passwordHash = await bcrypt.hash(password, 10);

      await db.query(
        `
          INSERT INTO users (id, first_name, middle_name, last_name, email, role, password_hash, brand_id)
          VALUES ($1, $2, $3, $4, $5, 'student', $6, $7)
        `,
        [
          studentId,
          firstName,
          middleName || null,
          lastName,
          String(email).toLowerCase().trim(),
          passwordHash,
          req.brandId
        ]
      );

      student = await db.one('SELECT * FROM users WHERE id = $1', [studentId]);
    } else if (student.role === 'student') {
      // If student already exists but is trying to join again with a password, update it
      const passwordHash = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
        passwordHash,
        student.id,
      ]);
      student = await db.one('SELECT * FROM users WHERE id = $1', [student.id]);
    } else {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // Enroll student
    const enrollmentId = uuidv4();
    await db.query(
      `
        INSERT INTO enrollments (id, class_id, student_id, brand_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (class_id, student_id) DO NOTHING
      `,
      [enrollmentId, classData.id, student.id, req.brandId]
    );

    // Create or get PRIVATE room for this student
    let room = await db.one(
      "SELECT * FROM chat_rooms WHERE class_id = $1 AND student_id = $2 AND type = 'private' AND brand_id = $3",
      [classData.id, student.id, req.brandId]
    );

    if (!room) {
      const roomId = uuidv4();
      await db.query(
        `
          INSERT INTO chat_rooms (id, class_id, student_id, type, brand_id)
          VALUES ($1, $2, $3, 'private', $4)
        `,
        [roomId, classData.id, student.id, req.brandId]
      );
      room = { id: roomId };
    }

    // Generate JWT token for student
    const token = generateToken(
      { id: student.id, email: student.email, role: student.role },
      req.brandId
    );

    // Keep response shape stable for web app (camelCase + no password).
    const studentWithoutPassword = {
      id: student.id,
      firstName: student.first_name,
      middleName: student.middle_name,
      lastName: student.last_name,
      email: student.email,
      role: student.role,
      brandId: student.brand_id,
      brandCode: req.brandCode
    };

    res.json({
      token,
      student: studentWithoutPassword,
      classData: classData,
      roomId: room.id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get students in a class
router.get('/:classId/students', async (req, res) => {
  try {
    const { classId } = req.params;

    const students = await db.many(
      `
        SELECT
          u.id,
          u.first_name as "firstName",
          u.last_name as "lastName",
          u.email,
          e.created_at as enrollment_date,
          cr.id as "roomId"
        FROM users u
        JOIN enrollments e ON e.student_id = u.id
        LEFT JOIN chat_rooms cr
          ON cr.class_id = e.class_id
          AND cr.student_id = u.id
          AND cr.type = 'private'
          AND cr.brand_id = $2
        WHERE e.class_id = $1 AND u.role = 'student' AND u.brand_id = $2
        ORDER BY e.created_at DESC
      `,
      [classId, req.brandId]
    );

    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete class
router.delete('/:classId', async (req, res) => {
  try {
    const { classId } = req.params;

    const classData = await db.one('SELECT * FROM classes WHERE id = $1 AND brand_id = $2', [classId, req.brandId]);

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Cascades handle enrollments + chat rooms.
    await db.query('DELETE FROM classes WHERE id = $1 AND brand_id = $2', [classId, req.brandId]);

    res.json({ success: true, message: 'Class deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
