/**
 * TeleprompTV Controller
 *
 * Business logic for TeleprompTV features.
 * All functions receive (req, res) and use:
 * - req.user (from verifyToken middleware)
 * - req.brandId, req.brandCode (from brandResolver middleware)
 */

import db from '../../db.js';
import { v4 as uuidv4 } from 'uuid';
import * as s3Service from '../../services/s3.service.js';
import * as openaiService from '../../services/openai.service.js';
import * as ffmpegService from '../../services/ffmpeg.service.js';
import * as creditsService from '../../services/credits.service.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// SCRIPT MANAGEMENT
// ============================================================================

/**
 * POST /api/ttv/scripts
 * Create a new teleprompt script
 */
export async function createScript(req, res) {
  try {
    const { title, scriptType = 'other', rawScript = '' } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const scriptId = uuidv4();

    await db.query(
      `INSERT INTO teleprompt_scripts (id, brand_id, created_by, title, script_type, raw_script, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW(), NOW())`,
      [scriptId, req.brandId, req.user.id, title.trim(), scriptType, rawScript]
    );

    const script = await db.one(
      'SELECT * FROM teleprompt_scripts WHERE id = $1 AND brand_id = $2',
      [scriptId, req.brandId]
    );

    res.status(201).json({ success: true, script });
  } catch (error) {
    console.error('Create script error:', error);
    res.status(500).json({ error: 'Failed to create script', details: error.message });
  }
}

/**
 * GET /api/ttv/scripts
 * List all scripts for the current brand
 */
export async function listScripts(req, res) {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM teleprompt_scripts WHERE brand_id = $1';
    const params = [req.brandId];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const scripts = await db.many(query, params);

    res.json({ success: true, scripts: scripts || [] });
  } catch (error) {
    console.error('List scripts error:', error);
    res.status(500).json({ error: 'Failed to list scripts', details: error.message });
  }
}

/**
 * GET /api/ttv/scripts/:id
 * Get a specific script by ID
 */
export async function getScriptById(req, res) {
  try {
    const { id } = req.params;

    const script = await db.one(
      'SELECT * FROM teleprompt_scripts WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }

    // Get associated cuts
    const cuts = await db.many(
      `SELECT * FROM teleprompt_text_cuts
       WHERE teleprompt_script_id = $1 AND brand_id = $2
       ORDER BY cut_order ASC`,
      [id, req.brandId]
    );

    res.json({ success: true, script: { ...script, cuts: cuts || [] } });
  } catch (error) {
    console.error('Get script error:', error);
    res.status(500).json({ error: 'Failed to get script', details: error.message });
  }
}

/**
 * PATCH /api/ttv/scripts/:id
 * Update a script
 */
export async function updateScript(req, res) {
  try {
    const { id } = req.params;
    const { title, scriptType, rawScript, status } = req.body;

    // Verify script exists and belongs to brand
    const existing = await db.one(
      'SELECT id FROM teleprompt_scripts WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Script not found' });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title.trim());
    }
    if (scriptType !== undefined) {
      updates.push(`script_type = $${paramIndex++}`);
      params.push(scriptType);
    }
    if (rawScript !== undefined) {
      updates.push(`raw_script = $${paramIndex++}`);
      params.push(rawScript);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = $${paramIndex++}`);
    params.push(new Date().toISOString());
    params.push(id);
    params.push(req.brandId);

    await db.query(
      `UPDATE teleprompt_scripts SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND brand_id = $${paramIndex++}`,
      params
    );

    const script = await db.one(
      'SELECT * FROM teleprompt_scripts WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    res.json({ success: true, script });
  } catch (error) {
    console.error('Update script error:', error);
    res.status(500).json({ error: 'Failed to update script', details: error.message });
  }
}

/**
 * DELETE /api/ttv/scripts/:id
 * Delete a script
 */
export async function deleteScript(req, res) {
  try {
    const { id } = req.params;

    const result = await db.result(
      'DELETE FROM teleprompt_scripts WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Script not found' });
    }

    res.json({ success: true, message: 'Script deleted' });
  } catch (error) {
    console.error('Delete script error:', error);
    res.status(500).json({ error: 'Failed to delete script', details: error.message });
  }
}

/**
 * POST /api/ttv/scripts/generate
 * Generate a script using AI
 */
export async function generateScript(req, res) {
  try {
    const { topic, style = 'professional', duration = 60, tone = 'informative' } = req.body;

    if (!topic || topic.trim().length === 0) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    // Check and charge credits
    const creditCost = creditsService.CREDIT_COSTS.AI_SCRIPT_GENERATION;
    const chargeResult = await creditsService.chargeForOperation(
      req.user.id,
      req.brandId,
      'AI Script Generation',
      creditCost,
      { topic, style, duration }
    );

    if (!chargeResult.success) {
      return res.status(402).json({
        error: chargeResult.error,
        message: chargeResult.message,
        required: chargeResult.required,
        available: chargeResult.available
      });
    }

    // Generate script using OpenAI
    const result = await openaiService.generateScript(topic, { style, duration, tone });

    res.json({
      success: true,
      script: result.scriptText,
      estimatedDuration: result.estimatedDuration,
      wordCount: result.wordCount,
      creditsCharged: creditCost,
      newBalance: chargeResult.newBalance
    });
  } catch (error) {
    console.error('Generate script error:', error);
    res.status(500).json({ error: 'Failed to generate script', details: error.message });
  }
}

// ============================================================================
// VIDEO MANAGEMENT
// ============================================================================

/**
 * POST /api/ttv/videos/upload-url
 * Get presigned URL for direct S3 upload from browser
 */
export async function getVideoUploadUrl(req, res) {
  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    const result = await s3Service.getPresignedUploadUrl(fileName, req.brandId, 'videos');

    res.json({
      success: true,
      uploadUrl: result.uploadUrl,
      s3Key: result.s3Key,
      expiresIn: result.expiresIn
    });
  } catch (error) {
    console.error('Get upload URL error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL', details: error.message });
  }
}

/**
 * POST /api/ttv/videos
 * Upload video file (multipart/form-data)
 */
export async function uploadVideo(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const { title, scriptId } = req.body;

    // Upload to S3
    const uploadResult = await s3Service.uploadToS3(
      req.file.buffer,
      req.file.originalname,
      req.brandId,
      'videos'
    );

    // Extract video metadata
    const tempPath = path.join(os.tmpdir(), `video-${Date.now()}.tmp`);
    fs.writeFileSync(tempPath, req.file.buffer);

    let metadata;
    try {
      metadata = await ffmpegService.getVideoMetadata(tempPath);
    } catch (metaError) {
      console.error('Metadata extraction failed:', metaError);
      metadata = { duration: null, size: req.file.size };
    } finally {
      fs.unlinkSync(tempPath);
    }

    // Create video record
    const videoId = uuidv4();
    await db.query(
      `INSERT INTO teleprompt_videos
       (id, brand_id, user_id, teleprompt_script_id, title, s3_key, s3_path, duration_seconds, file_size_bytes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        videoId,
        req.brandId,
        req.user.id,
        scriptId || null,
        title || req.file.originalname,
        uploadResult.s3Key,
        uploadResult.s3Path,
        metadata.duration || null,
        req.file.size
      ]
    );

    const video = await db.one(
      'SELECT * FROM teleprompt_videos WHERE id = $1 AND brand_id = $2',
      [videoId, req.brandId]
    );

    res.status(201).json({ success: true, video });
  } catch (error) {
    console.error('Upload video error:', error);
    res.status(500).json({ error: 'Failed to upload video', details: error.message });
  }
}

/**
 * POST /api/ttv/videos/finalize
 * Finalize video upload after S3 direct upload
 */
export async function finalizeVideo(req, res) {
  try {
    const { s3Key, title, scriptId, duration, fileSize } = req.body;

    if (!s3Key) {
      return res.status(400).json({ error: 's3Key is required' });
    }

    // Verify file exists in S3
    const exists = await s3Service.fileExists(s3Key);
    if (!exists) {
      return res.status(404).json({ error: 'Video not found in S3' });
    }

    // Create video record
    const videoId = uuidv4();
    await db.query(
      `INSERT INTO teleprompt_videos
       (id, brand_id, user_id, teleprompt_script_id, title, s3_key, s3_path, duration_seconds, file_size_bytes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        videoId,
        req.brandId,
        req.user.id,
        scriptId || null,
        title || 'Untitled Video',
        s3Key,
        s3Key,
        duration || null,
        fileSize || null
      ]
    );

    const video = await db.one(
      'SELECT * FROM teleprompt_videos WHERE id = $1 AND brand_id = $2',
      [videoId, req.brandId]
    );

    res.status(201).json({ success: true, video });
  } catch (error) {
    console.error('Finalize video error:', error);
    res.status(500).json({ error: 'Failed to finalize video', details: error.message });
  }
}

/**
 * GET /api/ttv/videos
 * List all videos for the current brand
 */
export async function listVideos(req, res) {
  try {
    const { scriptId, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM teleprompt_videos WHERE brand_id = $1';
    const params = [req.brandId];

    if (scriptId) {
      query += ' AND teleprompt_script_id = $2';
      params.push(scriptId);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const videos = await db.many(query, params);

    res.json({ success: true, videos: videos || [] });
  } catch (error) {
    console.error('List videos error:', error);
    res.status(500).json({ error: 'Failed to list videos', details: error.message });
  }
}

/**
 * GET /api/ttv/videos/:id
 * Get a specific video by ID
 */
export async function getVideoById(req, res) {
  try {
    const { id } = req.params;

    const video = await db.one(
      'SELECT * FROM teleprompt_videos WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Generate presigned download URL
    const downloadUrl = await s3Service.getPresignedDownloadUrl(video.s3_key);

    res.json({ success: true, video: { ...video, downloadUrl } });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: 'Failed to get video', details: error.message });
  }
}

/**
 * DELETE /api/ttv/videos/:id
 * Delete a video
 */
export async function deleteVideo(req, res) {
  try {
    const { id } = req.params;

    // Get video to access s3_key
    const video = await db.one(
      'SELECT s3_key FROM teleprompt_videos WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Delete from S3
    await s3Service.deleteFromS3(video.s3_key);

    // Delete from database
    await db.query(
      'DELETE FROM teleprompt_videos WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    res.json({ success: true, message: 'Video deleted' });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video', details: error.message });
  }
}

// ============================================================================
// TRANSCRIPTION
// ============================================================================

/**
 * POST /api/ttv/videos/:id/transcribe
 * Transcribe a video using OpenAI Whisper
 */
export async function transcribeVideo(req, res) {
  try {
    const { id } = req.params;
    const { language = 'en' } = req.body;

    // Get video
    const video = await db.one(
      'SELECT * FROM teleprompt_videos WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Calculate credit cost
    const durationMinutes = Math.ceil((video.duration_seconds || 60) / 60);
    const creditCost = creditsService.calculateTranscriptionCost(video.duration_seconds || 60);

    // Check and charge credits
    const chargeResult = await creditsService.chargeForOperation(
      req.user.id,
      req.brandId,
      'Video Transcription',
      creditCost,
      { videoId: id, durationMinutes }
    );

    if (!chargeResult.success) {
      return res.status(402).json({
        error: chargeResult.error,
        message: chargeResult.message,
        required: chargeResult.required,
        available: chargeResult.available
      });
    }

    // Download video from S3
    const downloadUrl = await s3Service.getPresignedDownloadUrl(video.s3_key, 3600);

    // Extract audio using ffmpeg
    const tempDir = os.tmpdir();
    const videoPath = path.join(tempDir, `video-${id}.mp4`);
    const audioPath = path.join(tempDir, `audio-${id}.mp3`);

    // Download video
    const response = await fetch(downloadUrl);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(videoPath, Buffer.from(buffer));

    // Extract audio
    await ffmpegService.extractAudio(videoPath, audioPath);

    // Transcribe audio
    const transcription = await openaiService.transcribeAudio(audioPath, { language });

    // Clean up temp files
    fs.unlinkSync(videoPath);
    fs.unlinkSync(audioPath);

    // Create transcript record
    const transcriptId = uuidv4();
    await db.query(
      `INSERT INTO teleprompt_transcripts
       (id, brand_id, teleprompt_video_id, user_id, full_text, language, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [transcriptId, req.brandId, id, req.user.id, transcription.text, transcription.language || language]
    );

    // Save transcript chunks
    if (transcription.segments) {
      for (const segment of transcription.segments) {
        await db.query(
          `INSERT INTO teleprompt_transcript_chunks
           (id, brand_id, teleprompt_transcript_id, start_time, end_time, text, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [uuidv4(), req.brandId, transcriptId, segment.startTime, segment.endTime, segment.text]
        );
      }
    }

    const transcript = await db.one(
      'SELECT * FROM teleprompt_transcripts WHERE id = $1 AND brand_id = $2',
      [transcriptId, req.brandId]
    );

    res.json({
      success: true,
      transcript,
      creditsCharged: creditCost,
      newBalance: chargeResult.newBalance
    });
  } catch (error) {
    console.error('Transcribe video error:', error);
    res.status(500).json({ error: 'Failed to transcribe video', details: error.message });
  }
}

/**
 * GET /api/ttv/videos/:id/transcript
 * Get transcript for a video
 */
export async function getTranscript(req, res) {
  try {
    const { id } = req.params;

    const transcript = await db.one(
      `SELECT * FROM teleprompt_transcripts
       WHERE teleprompt_video_id = $1 AND brand_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [id, req.brandId]
    );

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    // Get chunks
    const chunks = await db.many(
      `SELECT * FROM teleprompt_transcript_chunks
       WHERE teleprompt_transcript_id = $1 AND brand_id = $2
       ORDER BY start_time ASC`,
      [transcript.id, req.brandId]
    );

    res.json({ success: true, transcript: { ...transcript, chunks: chunks || [] } });
  } catch (error) {
    console.error('Get transcript error:', error);
    res.status(500).json({ error: 'Failed to get transcript', details: error.message });
  }
}

/**
 * GET /api/ttv/videos/:id/subtitles
 * Get subtitles in VTT or SRT format
 */
export async function getSubtitles(req, res) {
  try {
    const { id } = req.params;
    const { format = 'vtt' } = req.query;

    const transcript = await db.one(
      `SELECT * FROM teleprompt_transcripts
       WHERE teleprompt_video_id = $1 AND brand_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [id, req.brandId]
    );

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    // Get chunks
    const chunks = await db.many(
      `SELECT * FROM teleprompt_transcript_chunks
       WHERE teleprompt_transcript_id = $1 AND brand_id = $2
       ORDER BY start_time ASC`,
      [transcript.id, req.brandId]
    );

    const segments = (chunks || []).map(chunk => ({
      startTime: chunk.start_time,
      endTime: chunk.end_time,
      text: chunk.text
    }));

    let subtitles;
    if (format.toLowerCase() === 'srt') {
      subtitles = openaiService.generateSRT(segments);
      res.setHeader('Content-Type', 'application/x-subrip');
    } else {
      subtitles = openaiService.generateVTT(segments);
      res.setHeader('Content-Type', 'text/vtt');
    }

    res.send(subtitles);
  } catch (error) {
    console.error('Get subtitles error:', error);
    res.status(500).json({ error: 'Failed to get subtitles', details: error.message });
  }
}

// ============================================================================
// TEXT CUTS
// ============================================================================

/**
 * POST /api/ttv/scripts/:id/cuts
 * Create a text cut for a script
 */
export async function createCut(req, res) {
  try {
    const { id } = req.params;
    const { cutText, startTime, endTime, cutOrder } = req.body;

    // Verify script exists
    const script = await db.one(
      'SELECT id FROM teleprompt_scripts WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }

    const cutId = uuidv4();
    await db.query(
      `INSERT INTO teleprompt_text_cuts
       (id, brand_id, teleprompt_script_id, cut_text, start_time, end_time, cut_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [cutId, req.brandId, id, cutText, startTime || null, endTime || null, cutOrder || 0]
    );

    const cut = await db.one(
      'SELECT * FROM teleprompt_text_cuts WHERE id = $1 AND brand_id = $2',
      [cutId, req.brandId]
    );

    res.status(201).json({ success: true, cut });
  } catch (error) {
    console.error('Create cut error:', error);
    res.status(500).json({ error: 'Failed to create cut', details: error.message });
  }
}

/**
 * GET /api/ttv/scripts/:id/cuts
 * Get all cuts for a script
 */
export async function getCuts(req, res) {
  try {
    const { id } = req.params;

    const cuts = await db.many(
      `SELECT * FROM teleprompt_text_cuts
       WHERE teleprompt_script_id = $1 AND brand_id = $2
       ORDER BY cut_order ASC`,
      [id, req.brandId]
    );

    res.json({ success: true, cuts: cuts || [] });
  } catch (error) {
    console.error('Get cuts error:', error);
    res.status(500).json({ error: 'Failed to get cuts', details: error.message });
  }
}

/**
 * PATCH /api/ttv/cuts/:id
 * Update a cut
 */
export async function updateCut(req, res) {
  try {
    const { id } = req.params;
    const { cutText, startTime, endTime, cutOrder, status } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (cutText !== undefined) {
      updates.push(`cut_text = $${paramIndex++}`);
      params.push(cutText);
    }
    if (startTime !== undefined) {
      updates.push(`start_time = $${paramIndex++}`);
      params.push(startTime);
    }
    if (endTime !== undefined) {
      updates.push(`end_time = $${paramIndex++}`);
      params.push(endTime);
    }
    if (cutOrder !== undefined) {
      updates.push(`cut_order = $${paramIndex++}`);
      params.push(cutOrder);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = $${paramIndex++}`);
    params.push(new Date().toISOString());
    params.push(id);
    params.push(req.brandId);

    const result = await db.result(
      `UPDATE teleprompt_text_cuts SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND brand_id = $${paramIndex++}`,
      params
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cut not found' });
    }

    const cut = await db.one(
      'SELECT * FROM teleprompt_text_cuts WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    res.json({ success: true, cut });
  } catch (error) {
    console.error('Update cut error:', error);
    res.status(500).json({ error: 'Failed to update cut', details: error.message });
  }
}

/**
 * DELETE /api/ttv/cuts/:id
 * Delete a cut
 */
export async function deleteCut(req, res) {
  try {
    const { id } = req.params;

    const result = await db.result(
      'DELETE FROM teleprompt_text_cuts WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cut not found' });
    }

    res.json({ success: true, message: 'Cut deleted' });
  } catch (error) {
    console.error('Delete cut error:', error);
    res.status(500).json({ error: 'Failed to delete cut', details: error.message });
  }
}

/**
 * POST /api/ttv/scripts/:id/cuts/reorder
 * Reorder cuts within a script
 */
export async function reorderCuts(req, res) {
  try {
    const { id } = req.params;
    const { cutIds } = req.body; // Array of cut IDs in new order

    if (!Array.isArray(cutIds)) {
      return res.status(400).json({ error: 'cutIds must be an array' });
    }

    // Update cut_order for each cut
    for (let i = 0; i < cutIds.length; i++) {
      await db.query(
        `UPDATE teleprompt_text_cuts
         SET cut_order = $1, updated_at = NOW()
         WHERE id = $2 AND teleprompt_script_id = $3 AND brand_id = $4`,
        [i, cutIds[i], id, req.brandId]
      );
    }

    const cuts = await db.many(
      `SELECT * FROM teleprompt_text_cuts
       WHERE teleprompt_script_id = $1 AND brand_id = $2
       ORDER BY cut_order ASC`,
      [id, req.brandId]
    );

    res.json({ success: true, cuts: cuts || [] });
  } catch (error) {
    console.error('Reorder cuts error:', error);
    res.status(500).json({ error: 'Failed to reorder cuts', details: error.message });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * POST /api/ttv/exports
 * Start video export process
 */
export async function startExport(req, res) {
  try {
    const { scriptId, resolution = 'HD', settings = {} } = req.body;

    if (!scriptId) {
      return res.status(400).json({ error: 'scriptId is required' });
    }

    // Calculate credit cost
    const creditCost = creditsService.calculateExportCost(resolution);

    // Check and charge credits
    const chargeResult = await creditsService.chargeForOperation(
      req.user.id,
      req.brandId,
      'Video Export',
      creditCost,
      { scriptId, resolution }
    );

    if (!chargeResult.success) {
      return res.status(402).json({
        error: chargeResult.error,
        message: chargeResult.message,
        required: chargeResult.required,
        available: chargeResult.available
      });
    }

    const exportId = uuidv4();
    await db.query(
      `INSERT INTO teleprompt_exports
       (id, brand_id, user_id, teleprompt_script_id, export_status, resolution, settings, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW(), NOW())`,
      [exportId, req.brandId, req.user.id, scriptId, resolution, JSON.stringify(settings)]
    );

    const exportRecord = await db.one(
      'SELECT * FROM teleprompt_exports WHERE id = $1 AND brand_id = $2',
      [exportId, req.brandId]
    );

    // TODO: Queue background job to process export using FFmpeg
    // For now, just return the pending export

    res.status(201).json({
      success: true,
      export: exportRecord,
      creditsCharged: creditCost,
      newBalance: chargeResult.newBalance
    });
  } catch (error) {
    console.error('Start export error:', error);
    res.status(500).json({ error: 'Failed to start export', details: error.message });
  }
}

/**
 * GET /api/ttv/exports/:id
 * Get export status and details
 */
export async function getExport(req, res) {
  try {
    const { id } = req.params;

    const exportRecord = await db.one(
      'SELECT * FROM teleprompt_exports WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!exportRecord) {
      return res.status(404).json({ error: 'Export not found' });
    }

    // If export has S3 key, generate download URL
    let downloadUrl = null;
    if (exportRecord.s3_key) {
      downloadUrl = await s3Service.getPresignedDownloadUrl(exportRecord.s3_key);
    }

    res.json({ success: true, export: { ...exportRecord, downloadUrl } });
  } catch (error) {
    console.error('Get export error:', error);
    res.status(500).json({ error: 'Failed to get export', details: error.message });
  }
}

/**
 * GET /api/ttv/exports
 * List all exports for the current brand
 */
export async function listExports(req, res) {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const exports = await db.many(
      `SELECT * FROM teleprompt_exports
       WHERE brand_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.brandId, parseInt(limit), parseInt(offset)]
    );

    res.json({ success: true, exports: exports || [] });
  } catch (error) {
    console.error('List exports error:', error);
    res.status(500).json({ error: 'Failed to list exports', details: error.message });
  }
}

// ============================================================================
// PUBLISHING
// ============================================================================

/**
 * POST /api/ttv/publish
 * Publish a video
 */
export async function publishVideo(req, res) {
  try {
    const { videoId, title, description, visibility = 'private' } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    const publishId = uuidv4();
    await db.query(
      `INSERT INTO teleprompt_video_publishes
       (id, brand_id, user_id, teleprompt_video_id, title, description, visibility, publish_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW(), NOW())`,
      [publishId, req.brandId, req.user.id, videoId, title, description, visibility]
    );

    const publish = await db.one(
      'SELECT * FROM teleprompt_video_publishes WHERE id = $1 AND brand_id = $2',
      [publishId, req.brandId]
    );

    res.status(201).json({ success: true, publish });
  } catch (error) {
    console.error('Publish video error:', error);
    res.status(500).json({ error: 'Failed to publish video', details: error.message });
  }
}

/**
 * GET /api/ttv/publish/:id
 * Get publish status and details
 */
export async function getPublish(req, res) {
  try {
    const { id } = req.params;

    const publish = await db.one(
      'SELECT * FROM teleprompt_video_publishes WHERE id = $1 AND brand_id = $2',
      [id, req.brandId]
    );

    if (!publish) {
      return res.status(404).json({ error: 'Publish record not found' });
    }

    res.json({ success: true, publish });
  } catch (error) {
    console.error('Get publish error:', error);
    res.status(500).json({ error: 'Failed to get publish', details: error.message });
  }
}

// ============================================================================
// ANALYTICS
// ============================================================================

/**
 * POST /api/ttv/analytics
 * Track analytics event
 */
export async function trackAnalytics(req, res) {
  try {
    const { eventType, eventData = {} } = req.body;

    if (!eventType) {
      return res.status(400).json({ error: 'eventType is required' });
    }

    const analyticsId = uuidv4();
    await db.query(
      `INSERT INTO teleprompt_analytics
       (id, brand_id, user_id, event_type, event_data, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [analyticsId, req.brandId, req.user.id || null, eventType, JSON.stringify(eventData)]
    );

    res.json({ success: true, message: 'Event tracked' });
  } catch (error) {
    console.error('Track analytics error:', error);
    res.status(500).json({ error: 'Failed to track analytics', details: error.message });
  }
}

/**
 * GET /api/ttv/analytics
 * Get analytics data
 */
export async function getAnalytics(req, res) {
  try {
    const { eventType, startDate, endDate, limit = 100 } = req.query;

    let query = 'SELECT * FROM teleprompt_analytics WHERE brand_id = $1';
    const params = [req.brandId];
    let paramIndex = 2;

    if (eventType) {
      query += ` AND event_type = $${paramIndex++}`;
      params.push(eventType);
    }

    if (startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const analytics = await db.many(query, params);

    res.json({ success: true, analytics: analytics || [] });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Failed to get analytics', details: error.message });
  }
}

// ============================================================================
// CREDITS
// ============================================================================

/**
 * GET /api/ttv/credits/balance
 * Get user's credit balance
 */
export async function getCreditBalance(req, res) {
  try {
    const balance = await creditsService.getCreditBalance(req.user.id, req.brandId);

    res.json({ success: true, balance });
  } catch (error) {
    console.error('Get credit balance error:', error);
    res.status(500).json({ error: 'Failed to get credit balance', details: error.message });
  }
}

/**
 * GET /api/ttv/credits/history
 * Get credit transaction history
 */
export async function getCreditHistory(req, res) {
  try {
    const { limit = 50, offset = 0, type } = req.query;

    const transactions = await creditsService.getTransactionHistory(
      req.user.id,
      req.brandId,
      { limit: parseInt(limit), offset: parseInt(offset), type }
    );

    res.json({ success: true, transactions });
  } catch (error) {
    console.error('Get credit history error:', error);
    res.status(500).json({ error: 'Failed to get credit history', details: error.message });
  }
}
