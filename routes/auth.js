import { Router } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { generateToken } from '../middleware/auth.js';

const router = Router();

// Apply brand resolver to all auth routes
router.use(brandResolver);

async function handleSignup(req, res, role) {
  try {
    const { firstName, middleName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const emailLower = String(email).toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);

    // Check if user already exists for this brand
    const existingUser = await db.one(
      `SELECT id
       FROM users
       WHERE LOWER(email) = $1 AND brand_id = $2`,
      [emailLower, req.brandId]
    );

    if (existingUser) {
      return res.status(409).json({ error: 'Email already exists for this brand' });
    }

    // Create user (brand-scoped)
    const userId = uuidv4();
    await db.query(
      `INSERT INTO users (id, first_name, middle_name, last_name, email, role, password_hash, brand_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        firstName,
        middleName || null,
        lastName,
        emailLower,
        role,
        passwordHash,
        req.brandId,
      ]
    );

    const token = generateToken(
      { id: userId, email: emailLower, role },
      req.brandId
    );

    res.json({
      token,
      user: {
        id: userId,
        firstName,
        middleName,
        lastName,
        email: emailLower,
        role,
        brandId: req.brandId,
        brandCode: req.brandCode,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    if (String(error.message || '').toLowerCase().includes('duplicate key')) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'server_error' });
  }
}

// Teacher signup
router.post('/signup', async (req, res) => handleSignup(req, res, 'teacher'));

// Student signup
router.post('/signup/student', async (req, res) => handleSignup(req, res, 'student'));

// Login (teacher or student)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const emailLower = String(email).toLowerCase().trim();

    const user = await db.one(
      `SELECT id, brand_id, first_name, middle_name, last_name, email, role, password_hash
       FROM users
       WHERE LOWER(email) = $1 AND brand_id = $2`,
      [emailLower, req.brandId]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Students might not have passwords (join flow)
    if (!user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = generateToken(
      { id: user.id, email: user.email, role: user.role },
      req.brandId
    );

    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        middleName: user.middle_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
        brandId: user.brand_id,
        brandCode: req.brandCode
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
