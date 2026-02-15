/**
 * Learning Pathways Routes
 *
 * Endpoints for pathway discovery, enrollment, progress tracking, and recommendations
 */

import { Router } from 'express';
import { brandResolver } from '../middleware/brandResolver.js';
import { verifyToken } from '../middleware/auth.js';
import {
  createPathway,
  getPathwayWithSteps,
  getPublicPathways,
  updatePathway,
  deletePathway,
  addPathwayStep,
  reorderPathwaySteps,
  enrollStudent,
  updateStepProgress,
  getStudentPathways,
  getStudentStepProgress,
  generatePathwayRecommendations,
  getPathwayAnalytics
} from '../services/pathway.service.js';

const router = Router();
router.use(brandResolver);

// ============================================================================
// Public Pathway Discovery (no auth required for public pathways)
// ============================================================================

/**
 * GET /api/pathways
 * List public pathways with optional filtering
 * Query: ?app=law&type=core&proficiency=beginner&topic=law:criminal&search=Criminal
 */
router.get('/', async (req, res) => {
  try {
    const { app, type, proficiency, topic, search } = req.query;

    const pathways = await getPublicPathways({
      appCode: app,
      pathwayType: type,
      proficiency,
      topic,
      search
    });

    return res.json({
      success: true,
      count: pathways.length,
      pathways
    });
  } catch (error) {
    console.error('Error fetching pathways:', error);
    return res.status(500).json({
      error: 'FETCH_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/pathways/:pathwayId
 * Get pathway with all steps (no auth required for public pathways)
 */
router.get('/:pathwayId', async (req, res) => {
  try {
    const { pathwayId } = req.params;

    const pathway = await getPathwayWithSteps(pathwayId);

    return res.json({
      success: true,
      pathway
    });
  } catch (error) {
    console.error('Error fetching pathway:', error);
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: error.message
    });
  }
});

// ============================================================================
// Student Enrollment & Progress (auth required)
// ============================================================================

/**
 * POST /api/pathways/:pathwayId/enroll
 * Enroll student in a pathway
 * Body: { enrollmentType? } - self_enrolled (default), teacher_assigned, etc.
 */
router.post('/:pathwayId/enroll', verifyToken, async (req, res) => {
  try {
    const { pathwayId } = req.params;
    const { enrollmentType = 'self_enrolled' } = req.body;
    const userId = req.user.userId;

    const enrollment = await enrollStudent(userId, pathwayId, enrollmentType, req.brandId);

    return res.status(201).json({
      success: true,
      enrollment
    });
  } catch (error) {
    console.error('Error enrolling student:', error);
    const status = error.message.includes('Prerequisite') ? 400 : 500;
    return res.status(status).json({
      error: 'ENROLLMENT_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/pathways/my-pathways (alias)
 * Get student's enrolled pathways
 * Query: ?status=in_progress&app=law
 */
router.get('/student/my-pathways', verifyToken, async (req, res) => {
  try {
    const { status, app } = req.query;
    const userId = req.user.userId;

    const pathways = await getStudentPathways(userId, {
      status,
      appCode: app
    });

    return res.json({
      success: true,
      count: pathways.length,
      pathways
    });
  } catch (error) {
    console.error('Error fetching student pathways:', error);
    return res.status(500).json({
      error: 'FETCH_FAILED',
      message: error.message
    });
  }
});

/**
 * PUT /api/pathways/:pathwayId/steps/:stepId/progress
 * Update student's step completion status
 * Body: { status, score?, passed?, timeSpentSeconds? }
 */
router.put('/:pathwayId/steps/:stepId/progress', verifyToken, async (req, res) => {
  try {
    const { pathwayId, stepId } = req.params;
    const { status, score, passed, timeSpentSeconds } = req.body;
    const userId = req.user.userId;

    if (!status) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'status is required'
      });
    }

    const progress = await updateStepProgress(userId, pathwayId, stepId, {
      status,
      score,
      passed,
      timeSpentSeconds: timeSpentSeconds || 0
    });

    return res.json({
      success: true,
      progress
    });
  } catch (error) {
    console.error('Error updating step progress:', error);
    return res.status(500).json({
      error: 'UPDATE_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/pathways/:pathwayId/progress
 * Get student's detailed progress for a pathway
 */
router.get('/:pathwayId/progress', verifyToken, async (req, res) => {
  try {
    const { pathwayId } = req.params;
    const userId = req.user.userId;

    const progress = await getStudentStepProgress(userId, pathwayId);

    return res.json({
      success: true,
      progress
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: error.message
    });
  }
});

// ============================================================================
// Pathway Recommendations (auth required)
// ============================================================================

/**
 * GET /api/pathways/recommendations
 * Get AI-generated pathway recommendations for student
 * Query: ?app=law
 */
router.get('/student/recommendations', verifyToken, async (req, res) => {
  try {
    const { app = 'law' } = req.query;
    const userId = req.user.userId;

    const recommendations = await generatePathwayRecommendations(userId, app, req.brandId);

    return res.json({
      success: true,
      count: recommendations.length,
      recommendations
    });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return res.status(500).json({
      error: 'RECOMMENDATION_FAILED',
      message: error.message
    });
  }
});

/**
 * POST /api/pathways/recommendations/:recommendationId/dismiss
 * Dismiss a recommendation
 */
router.post('/recommendations/:recommendationId/dismiss', verifyToken, async (req, res) => {
  try {
    // Placeholder for recommendation dismissal
    // This would update the pathway_recommendations table with dismissed status
    return res.json({
      success: true,
      message: 'Recommendation dismissed'
    });
  } catch (error) {
    console.error('Error dismissing recommendation:', error);
    return res.status(500).json({
      error: 'DISMISS_FAILED',
      message: error.message
    });
  }
});

// ============================================================================
// Admin/Teacher Endpoints (requires authentication and role)
// ============================================================================

/**
 * POST /api/pathways
 * Create new pathway (admin only)
 * Body: { code, title, description, pathwayType, targetProficiency, appCode, ... }
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    // Check if user is admin (placeholder - extend with actual role check)
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access required'
      });
    }

    const {
      code,
      title,
      description,
      pathwayType,
      targetProficiency,
      appCode,
      topicIds,
      difficultyLevel,
      estimatedHours,
      isSequential,
      recommendedForGaps,
      tags
    } = req.body;

    if (!code || !title || !appCode) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'code, title, appCode are required'
      });
    }

    const pathway = await createPathway({
      brandId: req.brandId,
      code,
      title,
      description,
      pathwayType,
      targetProficiency,
      appCode,
      topicIds,
      difficultyLevel,
      estimatedHours,
      isSequential,
      recommendedForGaps,
      tags
    });

    return res.status(201).json({
      success: true,
      pathway
    });
  } catch (error) {
    console.error('Error creating pathway:', error);
    return res.status(500).json({
      error: 'CREATE_FAILED',
      message: error.message
    });
  }
});

/**
 * PUT /api/pathways/:pathwayId
 * Update pathway (admin only)
 */
router.put('/:pathwayId', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access required'
      });
    }

    const { pathwayId } = req.params;
    const updates = req.body;

    const updated = await updatePathway(pathwayId, updates);

    return res.json({
      success: true,
      pathway: updated
    });
  } catch (error) {
    console.error('Error updating pathway:', error);
    return res.status(500).json({
      error: 'UPDATE_FAILED',
      message: error.message
    });
  }
});

/**
 * DELETE /api/pathways/:pathwayId
 * Delete (soft-delete) pathway (admin only)
 */
router.delete('/:pathwayId', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access required'
      });
    }

    const { pathwayId } = req.params;

    await deletePathway(pathwayId);

    return res.json({
      success: true,
      message: 'Pathway deleted'
    });
  } catch (error) {
    console.error('Error deleting pathway:', error);
    return res.status(500).json({
      error: 'DELETE_FAILED',
      message: error.message
    });
  }
});

/**
 * POST /api/pathways/:pathwayId/steps
 * Add step to pathway (admin only)
 */
router.post('/:pathwayId/steps', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access required'
      });
    }

    const { pathwayId } = req.params;
    const {
      stepOrder,
      stepType,
      levelId,
      unitId,
      unitAssessmentId,
      prerequisiteStepIds,
      isRequired,
      estimatedMinutes
    } = req.body;

    if (!stepOrder || !stepType) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'stepOrder and stepType are required'
      });
    }

    const step = await addPathwayStep(pathwayId, {
      brandId: req.brandId,
      stepOrder,
      stepType,
      levelId,
      unitId,
      unitAssessmentId,
      prerequisiteStepIds,
      isRequired,
      estimatedMinutes
    });

    return res.status(201).json({
      success: true,
      step
    });
  } catch (error) {
    console.error('Error adding step:', error);
    return res.status(500).json({
      error: 'ADD_STEP_FAILED',
      message: error.message
    });
  }
});

/**
 * PUT /api/pathways/:pathwayId/reorder
 * Reorder steps in pathway (admin only)
 * Body: { steps: [{stepId, newOrder}, ...] }
 */
router.put('/:pathwayId/reorder', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access required'
      });
    }

    const { pathwayId } = req.params;
    const { steps } = req.body;

    if (!steps || !Array.isArray(steps)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'steps array is required'
      });
    }

    await reorderPathwaySteps(pathwayId, steps);

    return res.json({
      success: true,
      message: 'Steps reordered'
    });
  } catch (error) {
    console.error('Error reordering steps:', error);
    return res.status(500).json({
      error: 'REORDER_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/pathways/:pathwayId/analytics
 * Get pathway analytics (teacher/admin only)
 */
router.get('/:pathwayId/analytics', verifyToken, async (req, res) => {
  try {
    // Check if user is teacher or admin
    if (!['teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Teacher access required'
      });
    }

    const { pathwayId } = req.params;

    const analytics = await getPathwayAnalytics(pathwayId);

    return res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return res.status(500).json({
      error: 'ANALYTICS_FAILED',
      message: error.message
    });
  }
});

export default router;
