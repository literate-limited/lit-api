/**
 * Hearts On Fire Routes
 * Migrated from lit-bloated/server/routes/heartsOnFire.routes.js
 * Cardiovascular simulation scenarios
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Sanitize scenario for response
function sanitizeScenario(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    params: JSON.parse(row.params || '{}'),
    outputs: JSON.parse(row.outputs || '{}'),
    curves: JSON.parse(row.curves || '{}'),
    shareCode: row.share_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Trim curves to limit response size
function trimCurves(curves) {
  const trimmed = { ...(curves || {}) };
  const limitArr = (arr = [], limit = 240) => (Array.isArray(arr) ? arr.slice(0, limit) : []);
  trimmed.time = limitArr(trimmed.time);
  trimmed.capillaryPo2 = limitArr(trimmed.capillaryPo2);
  trimmed.capillaryPco2 = limitArr(trimmed.capillaryPco2);
  trimmed.saturation = limitArr(trimmed.saturation);
  trimmed.gradient = limitArr(trimmed.gradient);
  trimmed.co2Gradient = limitArr(trimmed.co2Gradient);
  return trimmed;
}

// Generate share code
async function generateShareCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < 5; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const existing = await db.one(
      'SELECT id FROM hearts_on_fire_scenarios WHERE share_code = $1',
      [code]
    );
    
    if (!existing) return code;
  }
  return uuidv4().substring(0, 8).toUpperCase();
}

// Create scenario
router.post('/scenarios', verifyToken, async (req, res) => {
  try {
    const { name, params, outputs, curves } = req.body || {};
    
    if (!name || !params) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Name and params required'
      });
    }

    const shareCode = await generateShareCode();
    const id = uuidv4();

    await db.query(
      `INSERT INTO hearts_on_fire_scenarios 
       (id, user_id, brand_id, name, params, outputs, curves, share_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        req.user.id,
        req.brandId,
        name.slice(0, 120),
        JSON.stringify(params),
        JSON.stringify(outputs || {}),
        JSON.stringify(trimCurves(curves)),
        shareCode
      ]
    );

    const scenario = await db.one(
      'SELECT * FROM hearts_on_fire_scenarios WHERE id = $1',
      [id]
    );

    return res.json({ scenario: sanitizeScenario(scenario) });
  } catch (err) {
    console.error('HOF save error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: err.message
    });
  }
});

// List user's scenarios
router.get('/scenarios', verifyToken, async (req, res) => {
  try {
    const scenarios = await db.many(
      `SELECT * FROM hearts_on_fire_scenarios 
       WHERE user_id = $1 AND brand_id = $2
       ORDER BY updated_at DESC
       LIMIT 50`,
      [req.user.id, req.brandId]
    );

    return res.json({
      scenarios: scenarios.map(sanitizeScenario)
    });
  } catch (err) {
    console.error('HOF list error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: err.message
    });
  }
});

// Get single scenario
router.get('/scenarios/:id', verifyToken, async (req, res) => {
  try {
    const scenario = await db.one(
      `SELECT * FROM hearts_on_fire_scenarios 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [req.params.id, req.user.id, req.brandId]
    );

    if (!scenario) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json({ scenario: sanitizeScenario(scenario) });
  } catch (err) {
    console.error('HOF get error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: err.message
    });
  }
});

// Update scenario
router.put('/scenarios/:id', verifyToken, async (req, res) => {
  try {
    const { name, params, outputs, curves } = req.body || {};

    // Verify ownership
    const existing = await db.one(
      `SELECT * FROM hearts_on_fire_scenarios 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [req.params.id, req.user.id, req.brandId]
    );

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name.slice(0, 120));
    }
    if (params !== undefined) {
      updates.push(`params = $${idx++}`);
      values.push(JSON.stringify(params));
    }
    if (outputs !== undefined) {
      updates.push(`outputs = $${idx++}`);
      values.push(JSON.stringify(outputs));
    }
    if (curves !== undefined) {
      updates.push(`curves = $${idx++}`);
      values.push(JSON.stringify(trimCurves(curves)));
    }

    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);

    await db.query(
      `UPDATE hearts_on_fire_scenarios SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    const scenario = await db.one(
      'SELECT * FROM hearts_on_fire_scenarios WHERE id = $1',
      [req.params.id]
    );

    return res.json({ scenario: sanitizeScenario(scenario) });
  } catch (err) {
    console.error('HOF update error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: err.message
    });
  }
});

// Delete scenario
router.delete('/scenarios/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM hearts_on_fire_scenarios 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [req.params.id, req.user.id, req.brandId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('HOF delete error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: err.message
    });
  }
});

// Get shared scenario (public)
router.get('/share/:code', async (req, res) => {
  try {
    const scenario = await db.one(
      'SELECT * FROM hearts_on_fire_scenarios WHERE share_code = $1 AND brand_id = $2',
      [req.params.code, req.brandId]
    );

    if (!scenario) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json({ scenario: sanitizeScenario(scenario) });
  } catch (err) {
    console.error('HOF share error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: err.message
    });
  }
});

export default router;
