/**
 * Image Routes
 * Migrated from lit-bloated/server/routes/image.routes.js
 * Adapted to lit-mvp architecture
 */

import { Router } from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { uploadToS3 } from '../services/s3.service.js';
import multer from 'multer';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Apply brand resolver
router.use(brandResolver);

// Get all images
router.get('/', async (req, res) => {
  try {
    const images = await db.many(
      'SELECT * FROM images WHERE brand_id = $1 ORDER BY created_at DESC',
      [req.brandId]
    );

    return res.status(200).json({ success: true, images });
  } catch (error) {
    console.error('Error fetching images:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

// Get single image
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const image = await db.one(
      'SELECT * FROM images WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    return res.status(200).json({ success: true, image });
  } catch (error) {
    console.error('Error fetching image:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

// Upload image (admin only)
router.post('/upload', verifyToken, requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check file size (10MB limit)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size is greater than 10MB' });
    }

    // Upload to S3
    const result = await uploadToS3(req.file.buffer, req.file.originalname, req.brandId, 'images');

    // Create image record in database
    const id = uuidv4();
    const image = await db.query(
      `INSERT INTO images (id, title, url, s3_key, brand_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, req.file.originalname, result.s3Url, result.s3Key, req.brandId]
    );

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      image: image.rows[0]
    });
  } catch (error) {
    console.error('Upload Error:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

// Create image record (admin only)
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { title, url, s3Key } = req.body;

    if (!title || !url) {
      return res.status(400).json({ error: 'Please provide title and image URL' });
    }

    const id = uuidv4();
    const image = await db.query(
      `INSERT INTO images (id, title, url, s3_key, brand_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, title, url, s3Key || null, req.brandId]
    );

    return res.status(201).json({
      success: true,
      message: 'Image record created successfully',
      image: image.rows[0]
    });
  } catch (error) {
    console.error('Error creating image:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

// Update image (admin only)
router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, url } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (url !== undefined) {
      updates.push(`url = $${idx++}`);
      values.push(url);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(id);
    values.push(req.brandId);

    const result = await db.query(
      `UPDATE images SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${idx++} AND brand_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Image updated successfully',
      image: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating image:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

// Delete image (admin only)
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const image = await db.one(
      'SELECT * FROM images WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    await db.query('DELETE FROM images WHERE id = $1 AND brand_id = $2', [id, req.brandId]);

    return res.status(200).json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting image:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

export default router;
