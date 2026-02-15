/**
 * Push Notification Routes
 * Migrated from lit-bloated/server/routes/push.routes.js
 * Web Push subscription management
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Subscribe to push notifications
router.post('/subscribe', verifyToken, async (req, res) => {
  try {
    const { endpoint, keys, deviceInfo = {} } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_SUBSCRIPTION',
        message: 'Endpoint and keys (p256dh, auth) are required'
      });
    }

    const userId = req.user.id;

    // Check if subscription already exists
    const existing = await db.one(
      'SELECT id FROM push_subscriptions WHERE endpoint = $1',
      [endpoint]
    );

    if (existing) {
      // Update existing subscription
      await db.query(
        `UPDATE push_subscriptions 
         SET user_id = $1, brand_id = $2, keys = $3, device_info = $4, updated_at = NOW()
         WHERE endpoint = $5`,
        [userId, req.brandId, JSON.stringify(keys), JSON.stringify(deviceInfo), endpoint]
      );
    } else {
      // Create new subscription
      const id = uuidv4();
      await db.query(
        `INSERT INTO push_subscriptions (id, user_id, brand_id, endpoint, keys, device_info)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, userId, req.brandId, endpoint, JSON.stringify(keys), JSON.stringify(deviceInfo)]
      );
    }

    res.json({
      success: true,
      message: 'Subscribed to push notifications'
    });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({
      success: false,
      error: 'SUBSCRIBE_FAILED',
      message: err.message
    });
  }
});

// Unsubscribe from push notifications
router.post('/unsubscribe', verifyToken, async (req, res) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        error: 'ENDPOINT_REQUIRED'
      });
    }

    await db.query(
      'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, req.user.id]
    );

    res.json({
      success: true,
      message: 'Unsubscribed from push notifications'
    });
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    res.status(500).json({
      success: false,
      error: 'UNSUBSCRIBE_FAILED',
      message: err.message
    });
  }
});

// Get user's subscriptions
router.get('/subscriptions', verifyToken, async (req, res) => {
  try {
    const subscriptions = await db.many(
      `SELECT id, endpoint, device_info, created_at
       FROM push_subscriptions
       WHERE user_id = $1 AND brand_id = $2`,
      [req.user.id, req.brandId]
    );

    res.json({
      success: true,
      subscriptions: subscriptions.map(s => ({
        ...s,
        deviceInfo: JSON.parse(s.device_info || '{}')
      }))
    });
  } catch (err) {
    console.error('Get subscriptions error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_SUBSCRIPTIONS_FAILED',
      message: err.message
    });
  }
});

export default router;
