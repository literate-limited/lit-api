import { Router } from 'express';
import db from '../db.js';
import { brandResolver } from '../middleware/brandResolver.js';

const router = Router();

// Apply brand resolver to all routes
router.use(brandResolver);

// Get messages for a room
router.get('/:roomId/messages', async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const messages = await db.many(
      `
        SELECT
          m.*,
          u.first_name as "firstName",
          u.last_name as "lastName",
          u.role
        FROM message m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1 AND m.brand_id = $2
        ORDER BY m.created_at ASC
        LIMIT $3
      `,
      [roomId, req.brandId, limit]
    );

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get room details
router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await db.one(
      `
        SELECT
          cr.*,
          c.name as "className",
          c.code as "classCode"
        FROM chat_rooms cr
        JOIN classes c ON c.id = cr.class_id
        WHERE cr.id = $1 AND cr.brand_id = $2
      `,
      [roomId, req.brandId]
    );

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Get participants
    const participants = await db.many(
      `
        SELECT DISTINCT
          u.id,
          u.first_name as "firstName",
          u.last_name as "lastName",
          u.role
        FROM users u
        WHERE u.brand_id = $2 AND u.id IN (
          SELECT teacher_id FROM classes WHERE id = $1 AND brand_id = $2
          UNION
          SELECT student_id FROM enrollments WHERE class_id = $1 AND brand_id = $2
        )
      `,
      [room.class_id, req.brandId]
    );

    res.json({
      ...room,
      participants
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
