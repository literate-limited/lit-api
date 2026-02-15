/**
 * TeleprompTV Routes
 *
 * API endpoints for TeleprompTV features:
 * - Script management (CRUD)
 * - Video upload and management
 * - Video transcription
 * - Export and publishing
 * - Analytics tracking
 */

import express from 'express';
import multer from 'multer';
import { brandResolver } from '../../middleware/brandResolver.js';
import { verifyToken } from '../../middleware/auth.js';
import * as controller from '../../controllers/ttv/teleprompt.js';

const router = express.Router();

// Configure multer for video uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB max file size
  }
});

// Apply brand resolver and authentication to all routes
router.use(brandResolver);
router.use(verifyToken);

// ============================================================================
// SCRIPT MANAGEMENT
// ============================================================================

/**
 * POST /api/ttv/scripts
 * Create a new teleprompt script
 */
router.post('/scripts', controller.createScript);

/**
 * GET /api/ttv/scripts
 * List all scripts for the current brand
 */
router.get('/scripts', controller.listScripts);

/**
 * GET /api/ttv/scripts/:id
 * Get a specific script by ID
 */
router.get('/scripts/:id', controller.getScriptById);

/**
 * PATCH /api/ttv/scripts/:id
 * Update a script
 */
router.patch('/scripts/:id', controller.updateScript);

/**
 * DELETE /api/ttv/scripts/:id
 * Delete a script
 */
router.delete('/scripts/:id', controller.deleteScript);

/**
 * POST /api/ttv/scripts/generate
 * Generate a script using AI
 */
router.post('/scripts/generate', controller.generateScript);

// ============================================================================
// VIDEO MANAGEMENT
// ============================================================================

/**
 * POST /api/ttv/videos/upload-url
 * Get presigned URL for direct S3 upload from browser
 */
router.post('/videos/upload-url', controller.getVideoUploadUrl);

/**
 * POST /api/ttv/videos
 * Upload video file (multipart/form-data)
 */
router.post('/videos', upload.single('video'), controller.uploadVideo);

/**
 * POST /api/ttv/videos/finalize
 * Finalize video upload after S3 direct upload
 */
router.post('/videos/finalize', controller.finalizeVideo);

/**
 * GET /api/ttv/videos
 * List all videos for the current brand
 */
router.get('/videos', controller.listVideos);

/**
 * GET /api/ttv/videos/:id
 * Get a specific video by ID
 */
router.get('/videos/:id', controller.getVideoById);

/**
 * DELETE /api/ttv/videos/:id
 * Delete a video
 */
router.delete('/videos/:id', controller.deleteVideo);

// ============================================================================
// TRANSCRIPTION
// ============================================================================

/**
 * POST /api/ttv/videos/:id/transcribe
 * Transcribe a video using OpenAI Whisper
 */
router.post('/videos/:id/transcribe', controller.transcribeVideo);

/**
 * GET /api/ttv/videos/:id/transcript
 * Get transcript for a video
 */
router.get('/videos/:id/transcript', controller.getTranscript);

/**
 * GET /api/ttv/videos/:id/subtitles
 * Get subtitles in VTT or SRT format
 * Query params: format=vtt|srt (default: vtt)
 */
router.get('/videos/:id/subtitles', controller.getSubtitles);

// ============================================================================
// TEXT CUTS
// ============================================================================

/**
 * POST /api/ttv/scripts/:id/cuts
 * Create a text cut for a script
 */
router.post('/scripts/:id/cuts', controller.createCut);

/**
 * GET /api/ttv/scripts/:id/cuts
 * Get all cuts for a script
 */
router.get('/scripts/:id/cuts', controller.getCuts);

/**
 * PATCH /api/ttv/cuts/:id
 * Update a cut
 */
router.patch('/cuts/:id', controller.updateCut);

/**
 * DELETE /api/ttv/cuts/:id
 * Delete a cut
 */
router.delete('/cuts/:id', controller.deleteCut);

/**
 * POST /api/ttv/scripts/:id/cuts/reorder
 * Reorder cuts within a script
 */
router.post('/scripts/:id/cuts/reorder', controller.reorderCuts);

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * POST /api/ttv/exports
 * Start video export process
 */
router.post('/exports', controller.startExport);

/**
 * GET /api/ttv/exports/:id
 * Get export status and details
 */
router.get('/exports/:id', controller.getExport);

/**
 * GET /api/ttv/exports
 * List all exports for the current brand
 */
router.get('/exports', controller.listExports);

// ============================================================================
// PUBLISHING
// ============================================================================

/**
 * POST /api/ttv/publish
 * Publish a video
 */
router.post('/publish', controller.publishVideo);

/**
 * GET /api/ttv/publish/:id
 * Get publish status and details
 */
router.get('/publish/:id', controller.getPublish);

// ============================================================================
// ANALYTICS
// ============================================================================

/**
 * POST /api/ttv/analytics
 * Track analytics event
 */
router.post('/analytics', controller.trackAnalytics);

/**
 * GET /api/ttv/analytics
 * Get analytics data
 */
router.get('/analytics', controller.getAnalytics);

// ============================================================================
// CREDITS
// ============================================================================

/**
 * GET /api/ttv/credits/balance
 * Get user's credit balance
 */
router.get('/credits/balance', controller.getCreditBalance);

/**
 * GET /api/ttv/credits/history
 * Get credit transaction history
 */
router.get('/credits/history', controller.getCreditHistory);

export default router;
