/**
 * Sound Routes
 * Migrated from lit-bloated/server/routes/sound.routes.js
 * Adapted to lit-mvp architecture
 */

import { Router } from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { uploadToS3, getS3Client, getBucketName } from '../services/s3.service.js';
import multer from 'multer';
import path from 'path';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Configure multer for audio uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: function (req, file, cb) {
    const filetypes = /mp3|wav|flac|ogg|m4a/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Error: Audio files only!'));
    }
  }
}).single('audioFile');

// Apply brand resolver
router.use(brandResolver);

// Get all sounds from S3
router.get('/files', async (req, res) => {
  try {
    const s3Client = getS3Client();
    const bucketName = getBucketName();

    const data = await s3Client.listObjects({
      Bucket: bucketName,
      Prefix: `sounds/${req.brandId}/`
    }).promise();

    const audioFiles = (data.Contents || []).map(file => ({
      key: file.Key,
      url: `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${file.Key}`,
      size: file.Size,
      lastModified: file.LastModified
    }));

    return res.status(200).json({ success: true, audioFiles });
  } catch (error) {
    console.error('Error fetching audio files:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve audio files', error: error.message });
  }
});

// Get all sounds from database
router.get('/', async (req, res) => {
  try {
    const sounds = await db.many(
      'SELECT * FROM sounds WHERE brand_id = $1 ORDER BY created_at DESC',
      [req.brandId]
    );

    return res.status(200).json({
      success: true,
      sounds,
      count: sounds.length,
      message: 'Sounds retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching sounds:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Get level sounds
router.get('/level-sounds', async (req, res) => {
  try {
    const s3Client = getS3Client();
    const bucketName = getBucketName();

    const data = await s3Client.listObjects({
      Bucket: bucketName,
      Prefix: `levelSounds/${req.brandId}/`
    }).promise();

    const levelAudioFiles = (data.Contents || []).map(file => ({
      key: file.Key,
      url: `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${file.Key}`
    }));

    return res.status(200).json({ success: true, levelAudioFiles });
  } catch (error) {
    console.error('Error fetching level sounds:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve level audio files', error: error.message });
  }
});

// Get single sound
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sound = await db.one(
      'SELECT * FROM sounds WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!sound) {
      return res.status(404).json({ success: false, message: 'Sound not found' });
    }

    return res.status(200).json({ success: true, sound });
  } catch (error) {
    console.error('Error fetching sound:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve sound', error: error.message });
  }
});

// Upload sound (admin only)
router.post('/upload', verifyToken, requireRole('admin'), (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Error: No File Selected!' });
    }

    try {
      // Upload to S3
      const result = await uploadToS3(req.file.buffer, req.file.originalname, req.brandId, 'sounds');

      // Extract fields from request
      const { name, answer, language, alphabetType, points } = req.body;

      // Create sound record in database
      const id = uuidv4();
      const sound = await db.query(
        `INSERT INTO sounds (id, name, sound_url, answer, language, alphabet_type, points, brand_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [id, name || req.file.originalname, result.s3Url, answer || '', language || null, alphabetType || null, points || 0, req.brandId]
      );

      return res.status(200).json({
        success: true,
        message: 'File uploaded and sound data saved successfully',
        sound: sound.rows[0]
      });
    } catch (error) {
      console.error('Upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'File upload or sound data save failed',
        error: error.message
      });
    }
  });
});

// Create sound record (admin only)
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, soundUrl, answer, language, alphabetType, points, imageId } = req.body;

    if (!name || !soundUrl || !answer) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name, sound URL, and answer for the sound'
      });
    }

    const id = uuidv4();
    const sound = await db.query(
      `INSERT INTO sounds (id, name, sound_url, answer, language, alphabet_type, points, image_id, brand_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, name, soundUrl, answer, language || null, alphabetType || null, points || 0, imageId || null, req.brandId]
    );

    return res.status(201).json({
      success: true,
      sound: sound.rows[0],
      message: 'Sound created successfully'
    });
  } catch (error) {
    console.error('Error creating sound:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while creating the sound'
    });
  }
});

// Create multiple sounds (admin only)
router.post('/batch', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { sounds } = req.body;

    if (!Array.isArray(sounds) || sounds.length === 0) {
      return res.status(400).json({ success: false, error: 'Please provide an array of sounds' });
    }

    const values = sounds.map(s => ({
      id: uuidv4(),
      name: s.name,
      sound_url: s.soundUrl,
      answer: s.answer,
      language: s.language || null,
      alphabet_type: s.alphabetType || null,
      points: s.points || 0,
      image_id: s.imageId || null,
      brand_id: req.brandId
    }));

    const createdSounds = [];
    for (const v of values) {
      const result = await db.query(
        `INSERT INTO sounds (id, name, sound_url, answer, language, alphabet_type, points, image_id, brand_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [v.id, v.name, v.sound_url, v.answer, v.language, v.alphabet_type, v.points, v.image_id, v.brand_id]
      );
      createdSounds.push(result.rows[0]);
    }

    return res.status(201).json({
      success: true,
      sounds: createdSounds,
      message: 'Sounds created successfully'
    });
  } catch (error) {
    console.error('Error creating sounds:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Update sound (admin only)
router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, soundUrl, answer, language, alphabetType, points, imageId } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name);
    }
    if (soundUrl !== undefined) {
      updates.push(`sound_url = $${idx++}`);
      values.push(soundUrl);
    }
    if (answer !== undefined) {
      updates.push(`answer = $${idx++}`);
      values.push(answer);
    }
    if (language !== undefined) {
      updates.push(`language = $${idx++}`);
      values.push(language);
    }
    if (alphabetType !== undefined) {
      updates.push(`alphabet_type = $${idx++}`);
      values.push(alphabetType);
    }
    if (points !== undefined) {
      updates.push(`points = $${idx++}`);
      values.push(points);
    }
    if (imageId !== undefined) {
      updates.push(`image_id = $${idx++}`);
      values.push(imageId);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(id);
    values.push(req.brandId);

    const result = await db.query(
      `UPDATE sounds SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${idx++} AND brand_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sound not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Sound updated successfully',
      sound: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating sound:', error);
    return res.status(500).json({ success: false, message: 'Failed to update sound', error: error.message });
  }
});

// Delete sound (admin only)
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const sound = await db.one('SELECT * FROM sounds WHERE id = $1 AND brand_id = $2', [id, req.brandId]);

    if (!sound) {
      return res.status(404).json({ success: false, message: 'Sound not found' });
    }

    await db.query('DELETE FROM sounds WHERE id = $1 AND brand_id = $2', [id, req.brandId]);

    return res.status(200).json({ success: true, message: 'Sound deleted successfully' });
  } catch (error) {
    console.error('Error deleting sound:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete sound', error: error.message });
  }
});

// Check answer
router.post('/:id/check-answer', async (req, res) => {
  try {
    const { id } = req.params;
    const { answer } = req.body;

    const sound = await db.one(
      'SELECT * FROM sounds WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!sound) {
      return res.status(404).json({ success: false, message: 'Sound not found' });
    }

    const isCorrect = sound.answer.toLowerCase().trim() === answer?.toLowerCase().trim();

    return res.status(200).json({
      success: true,
      correct: isCorrect,
      message: isCorrect ? 'Correct Answer' : 'Incorrect Answer'
    });
  } catch (error) {
    console.error('Error checking answer:', error);
    return res.status(500).json({ success: false, message: 'Failed to check answer', error: error.message });
  }
});

// Search sounds
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide a search query' });
    }

    const sounds = await db.many(
      `SELECT * FROM sounds 
       WHERE brand_id = $1 AND (name ILIKE $2 OR answer ILIKE $2)
       ORDER BY created_at DESC`,
      [req.brandId, `%${q}%`]
    );

    return res.status(200).json({ success: true, sounds });
  } catch (error) {
    console.error('Error searching sounds:', error);
    return res.status(500).json({ success: false, message: 'Failed to search sounds', error: error.message });
  }
});

export default router;
