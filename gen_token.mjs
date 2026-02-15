import jwt from 'jsonwebtoken';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const testEmail = 'lawtest@example.com';

// Get test user
const user = await db.one('SELECT id, email, brand_id FROM users WHERE email = $1', [testEmail]);

const token = jwt.sign(
  {
    userId: user.id,
    email: user.email,
    brandId: user.brand_id
  },
  JWT_SECRET,
  { expiresIn: '24h' }
);

console.log('Token:', token);
console.log('\nTest with:');
console.log(`curl -H "Authorization: Bearer ${token}" http://localhost:3001/api/law/assessment`);

process.exit(0);
