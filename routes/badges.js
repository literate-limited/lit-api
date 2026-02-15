/**
 * Badges Routes
 * Migrated from lit-bloated/server/routes/badges.routes.js
 * Badge/achievement system
 */

import { Router } from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Get all badges (public)
router.get('/', async (req, res) => {
  try {
    const badges = await db.many(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM user_badges WHERE badge_id = b.id) as times_earned
       FROM badges b
       WHERE b.brand_id = $1 AND b.active = true
       ORDER BY b.category, b.name`,
      [req.brandId]
    );

    res.json({
      success: true,
      badges: badges.map(b => ({
        ...b,
        criteria: JSON.parse(b.criteria || '{}')
      }))
    });
  } catch (err) {
    console.error('Get badges error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_BADGES_FAILED',
      message: err.message
    });
  }
});

// Get single badge
router.get('/:id', async (req, res) => {
  try {
    const badge = await db.one(
      `SELECT b.*,
        (SELECT json_agg(u.*) FROM (
          SELECT u.id, u.first_name, u.last_name, ub.earned_at
          FROM user_badges ub
          JOIN users u ON u.id = ub.user_id
          WHERE ub.badge_id = b.id
          ORDER BY ub.earned_at DESC
          LIMIT 10
        ) u) as recent_earners
       FROM badges b
       WHERE b.id = $1 AND b.brand_id = $2`,
      [req.params.id, req.brandId]
    );

    if (!badge) {
      return res.status(404).json({
        success: false,
        error: 'BADGE_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      badge: {
        ...badge,
        criteria: JSON.parse(badge.criteria || '{}')
      }
    });
  } catch (err) {
    console.error('Get badge error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_BADGE_FAILED',
      message: err.message
    });
  }
});

// Get user's badges
router.get('/user/me', verifyToken, async (req, res) => {
  try {
    const badges = await db.many(
      `SELECT b.*, ub.earned_at, ub.metadata as earned_metadata
       FROM user_badges ub
       JOIN badges b ON b.id = ub.badge_id
       WHERE ub.user_id = $1 AND ub.brand_id = $2
       ORDER BY ub.earned_at DESC`,
      [req.user.id, req.brandId]
    );

    res.json({
      success: true,
      badges: badges.map(b => ({
        id: b.id,
        name: b.name,
        description: b.description,
        icon: b.icon,
        category: b.category,
        earnedAt: b.earned_at,
        metadata: JSON.parse(b.earned_metadata || '{}')
      }))
    });
  } catch (err) {
    console.error('Get user badges error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_USER_BADGES_FAILED',
      message: err.message
    });
  }
});

// Create badge (admin only)
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, icon, category, criteria, points = 0 } = req.body;

    if (!name || !description) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'Name and description are required'
      });
    }

    const id = uuidv4();
    const badge = await db.query(
      `INSERT INTO badges (id, brand_id, name, description, icon, category, criteria, points)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, req.brandId, name, description, icon || null, category || 'general', 
       JSON.stringify(criteria || {}), points]
    );

    res.status(201).json({
      success: true,
      badge: {
        ...badge.rows[0],
        criteria: JSON.parse(badge.rows[0].criteria || '{}')
      }
    });
  } catch (err) {
    console.error('Create badge error:', err);
    res.status(500).json({
      success: false,
      error: 'CREATE_BADGE_FAILED',
      message: err.message
    });
  }
});

// Award badge to user (admin only)
router.post('/:id/award', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { userId, metadata = {} } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'USER_ID_REQUIRED'
      });
    }

    // Verify badge exists
    const badge = await db.one(
      'SELECT * FROM badges WHERE id = $1 AND brand_id = $2',
      [req.params.id, req.brandId]
    );

    if (!badge) {
      return res.status(404).json({
        success: false,
        error: 'BADGE_NOT_FOUND'
      });
    }

    // Award badge
    const id = uuidv4();
    await db.query(
      `INSERT INTO user_badges (id, user_id, badge_id, brand_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, badge_id) DO NOTHING`,
      [id, userId, req.params.id, req.brandId, JSON.stringify(metadata)]
    );

    res.json({
      success: true,
      message: 'Badge awarded successfully'
    });
  } catch (err) {
    console.error('Award badge error:', err);
    res.status(500).json({
      success: false,
      error: 'AWARD_BADGE_FAILED',
      message: err.message
    });
  }
});

// Update badge (admin only)
router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, icon, category, criteria, points, active } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description);
    }
    if (icon !== undefined) {
      updates.push(`icon = $${idx++}`);
      values.push(icon);
    }
    if (category !== undefined) {
      updates.push(`category = $${idx++}`);
      values.push(category);
    }
    if (criteria !== undefined) {
      updates.push(`criteria = $${idx++}`);
      values.push(JSON.stringify(criteria));
    }
    if (points !== undefined) {
      updates.push(`points = $${idx++}`);
      values.push(points);
    }
    if (active !== undefined) {
      updates.push(`active = $${idx++}`);
      values.push(active);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'NO_FIELDS_TO_UPDATE'
      });
    }

    values.push(req.params.id);
    values.push(req.brandId);

    const result = await db.query(
      `UPDATE badges SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${idx++} AND brand_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'BADGE_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      badge: {
        ...result.rows[0],
        criteria: JSON.parse(result.rows[0].criteria || '{}')
      }
    });
  } catch (err) {
    console.error('Update badge error:', err);
    res.status(500).json({
      success: false,
      error: 'UPDATE_BADGE_FAILED',
      message: err.message
    });
  }
});

// Delete badge (admin only)
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM badges WHERE id = $1 AND brand_id = $2',
      [req.params.id, req.brandId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'BADGE_NOT_FOUND'
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete badge error:', err);
    res.status(500).json({
      success: false,
      error: 'DELETE_BADGE_FAILED',
      message: err.message
    });
  }
});

export default router;
