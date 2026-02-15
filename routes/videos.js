/**
 * Video Routes
 * Migrated from lit-bloated/server/routes/video.routes.js
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
const upload = multer({ storage: multer.memoryStorage() });

// Apply brand resolver
router.use(brandResolver);

// Get all videos (public)
router.get('/', async (req, res) => {
  try {
    const videos = await db.many(
      'SELECT * FROM videos WHERE brand_id = $1 ORDER BY created_at DESC',
      [req.brandId]
    );
    
    res.status(200).json({
      success: true,
      videos,
      message: 'Videos retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create video (admin only)
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { title, link, description } = req.body;

    if (!title || !link) {
      return res.status(400).json({
        success: false,
        error: 'Please provide title and video link'
      });
    }

    const id = uuidv4();
    const video = await db.query(
      `INSERT INTO videos (id, title, link, description, brand_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, title, link, description || null, req.brandId]
    );

    return res.status(201).json({
      success: true,
      video: video.rows[0],
      message: 'Video created successfully'
    });
  } catch (error) {
    console.error('Error creating video:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while creating the video'
    });
  }
});

// Upload video to S3 (admin only)
router.post('/upload', verifyToken, requireRole('admin'), upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check file size (10MB limit)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size is greater than 10MB' });
    }

    // Upload to S3
    const result = await uploadToS3(req.file.buffer, req.file.originalname, req.brandId, 'videos');

    res.status(200).json({
      success: true,
      message: 'Video uploaded successfully',
      url: result.s3Url,
      s3Key: result.s3Key
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

// Delete video (admin only)
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const video = await db.one('SELECT * FROM videos WHERE id = $1 AND brand_id = $2', [id, req.brandId]);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    await db.query('DELETE FROM videos WHERE id = $1 AND brand_id = $2', [id, req.brandId]);

    return res.status(200).json({
      success: true,
      message: 'Video deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting video:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
