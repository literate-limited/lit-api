/**
 * Progress Routes
 * Migrated from lit-bloated/server/routes/progress.routes.js
 * Student learning progress tracking
 */

import { Router } from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// All progress routes require authentication
router.use(verifyToken);

// Update progress
router.post('/', async (req, res) => {
  try {
    const { 
      levelId, 
      unitId, 
      isCorrect, 
      userAnswer, 
      timeSpentSeconds,
      metadata = {} 
    } = req.body;

    if (!levelId) {
      return res.status(400).json({
        success: false,
        error: 'LEVEL_ID_REQUIRED'
      });
    }

    const userId = req.user.id;

    // Get current attempt number
    const previousAttempts = await db.many(
      `SELECT attempt_number FROM level_progress 
       WHERE user_id = $1 AND level_id = $2
       ORDER BY attempt_number DESC
       LIMIT 1`,
      [userId, levelId]
    );

    const attemptNumber = previousAttempts.length > 0 ? 
      previousAttempts[0].attempt_number + 1 : 1;

    // Record progress
    const progressId = uuidv4();
    await db.query(
      `INSERT INTO level_progress 
       (id, user_id, level_id, started_at, completed_at, user_answer, is_correct, 
        time_spent_seconds, attempt_number, metadata)
       VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6, $7, $8)`,
      [progressId, userId, levelId, userAnswer || null, isCorrect, 
       timeSpentSeconds || null, attemptNumber, JSON.stringify(metadata)]
    );

    // Update unit assignment if applicable
    if (unitId && isCorrect) {
      await db.query(
        `UPDATE unit_assignment 
         SET status = 'completed', completed_at = NOW()
         WHERE user_id = $1 AND unit_id = $2`,
        [userId, unitId]
      );
    }

    // Update student assessment
    await updateStudentAssessment(userId, req.brandId);

    res.json({
      success: true,
      progress: {
        id: progressId,
        levelId,
        attemptNumber,
        isCorrect,
        completedAt: new Date()
      }
    });
  } catch (err) {
    console.error('Update progress error:', err);
    res.status(500).json({
      success: false,
      error: 'UPDATE_PROGRESS_FAILED',
      message: err.message
    });
  }
});

// Get user's progress summary
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get overall stats
    const stats = await db.one(
      `SELECT 
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN is_correct = true THEN 1 END) as correct_attempts,
        COUNT(DISTINCT level_id) as levels_attempted,
        COUNT(DISTINCT CASE WHEN is_correct = true THEN level_id END) as levels_completed,
        COALESCE(SUM(time_spent_seconds), 0) as total_time_seconds
       FROM level_progress
       WHERE user_id = $1`,
      [userId]
    );

    // Get progress by unit
    const unitProgress = await db.many(
      `SELECT 
        ua.unit_id,
        u.name as unit_name,
        ua.status,
        ua.assigned_at,
        ua.completed_at,
        ua.unit_score
       FROM unit_assignment ua
       JOIN unit u ON u.id = ua.unit_id
       WHERE ua.user_id = $1
       ORDER BY ua.assigned_at DESC`,
      [userId]
    );

    // Get recent activity
    const recentActivity = await db.many(
      `SELECT 
        lp.*,
        l.unit_id,
        u.name as unit_name
       FROM level_progress lp
       JOIN level l ON l.id = lp.level_id
       LEFT JOIN unit u ON u.id = l.unit_id
       WHERE lp.user_id = $1
       ORDER BY lp.completed_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json({
      success: true,
      summary: {
        totalAttempts: parseInt(stats.total_attempts),
        correctAttempts: parseInt(stats.correct_attempts),
        accuracy: stats.total_attempts > 0 ? 
          Math.round((stats.correct_attempts / stats.total_attempts) * 100) : 0,
        levelsAttempted: parseInt(stats.levels_attempted),
        levelsCompleted: parseInt(stats.levels_completed),
        totalTimeMinutes: Math.round(stats.total_time_seconds / 60)
      },
      unitProgress,
      recentActivity: recentActivity.map(a => ({
        ...a,
        metadata: JSON.parse(a.metadata || '{}')
      }))
    });
  } catch (err) {
    console.error('Get progress summary error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_PROGRESS_FAILED',
      message: err.message
    });
  }
});

// Get class progress (teacher/admin only)
router.get('/class/:classId', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { classId } = req.params;

    // Verify teacher owns this class
    if (req.user.role === 'teacher') {
      const classData = await db.one(
        'SELECT teacher_id FROM classes WHERE id = $1 AND brand_id = $2',
        [classId, req.brandId]
      );
      
      if (!classData || String(classData.teacher_id) !== String(req.user.id)) {
        return res.status(403).json({
          success: false,
          error: 'NOT_AUTHORIZED'
        });
      }
    }

    // Get all students in class with their progress
    const students = await db.many(
      `SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        e.created_at as enrolled_at,
        COUNT(DISTINCT lp.level_id) as levels_attempted,
        COUNT(DISTINCT CASE WHEN lp.is_correct = true THEN lp.level_id END) as levels_completed,
        COUNT(lp.id) as total_attempts,
        MAX(lp.completed_at) as last_activity
       FROM users u
       JOIN enrollments e ON e.student_id = u.id
       LEFT JOIN level_progress lp ON lp.user_id = u.id
       WHERE e.class_id = $1 AND u.brand_id = $2
       GROUP BY u.id, u.first_name, u.last_name, u.email, e.created_at
       ORDER BY e.created_at DESC`,
      [classId, req.brandId]
    );

    res.json({
      success: true,
      students: students.map(s => ({
        ...s,
        progress: s.total_attempts > 0 ? 
          Math.round((s.levels_completed / s.levels_attempted) * 100) : 0
      }))
    });
  } catch (err) {
    console.error('Get class progress error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_CLASS_PROGRESS_FAILED',
      message: err.message
    });
  }
});

// Helper to update student assessment
async function updateStudentAssessment(userId, brandId) {
  try {
    // Calculate recent performance metrics
    const metrics = await db.one(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_correct = true THEN 1 END) as correct,
        AVG(CASE WHEN time_spent_seconds > 0 THEN time_spent_seconds END) as avg_time
       FROM level_progress
       WHERE user_id = $1 AND completed_at > NOW() - INTERVAL '30 days'`,
      [userId]
    );

    const errorRate = metrics.total > 0 ? 
      (metrics.total - metrics.correct) / metrics.total : 1;
    const fluencyScore = metrics.avg_time ? 
      Math.max(0, Math.min(100, 100 - (metrics.avg_time / 10))) : 0;

    await db.query(
      `INSERT INTO student_assessment (id, user_id, brand_id, error_rate, fluency_score, assessed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
       error_rate = $4, fluency_score = $5, assessed_at = NOW()`,
      [uuidv4(), userId, brandId, errorRate, fluencyScore]
    );
  } catch (err) {
    console.error('Update assessment error:', err);
  }
}

export default router;
