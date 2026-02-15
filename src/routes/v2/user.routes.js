/**
 * User Routes
 * All user management endpoints (v2 API)
 */

const express = require('express');
const { authMiddleware } = require('../../middleware/auth');

/**
 * Create user routes
 * @param {UserController} userController - User controller instance
 * @returns {express.Router} Express router with user routes
 */
function createUserRoutes(userController) {
  const router = express.Router();

  // All user routes require authentication
  router.use(authMiddleware);

  /**
   * GET /api/v2/users/me
   * Get current user profile
   */
  router.get('/me', (req, res, next) => userController.getCurrentUser(req, res, next));

  /**
   * PUT /api/v2/users/me
   * Update current user profile
   * Body: { firstName?, lastName?, displayLanguage?, nativeLanguage?, metadata? }
   */
  router.put('/me', (req, res, next) => userController.updateCurrentUser(req, res, next));

  /**
   * POST /api/v2/users/me/onboarding
   * Update onboarding stage
   * Body: { stage: 'needs' | 'started' | 'completed' }
   */
  router.post('/me/onboarding', (req, res, next) => userController.updateOnboardingStage(req, res, next));

  /**
   * GET /api/v2/users/me/activity
   * Get current user activity
   */
  router.get('/me/activity', (req, res, next) => userController.getCurrentUserActivity(req, res, next));

  /**
   * GET /api/v2/users/search
   * Search users by role (admin only)
   * Query: { role, limit?, offset? }
   */
  router.get('/search', (req, res, next) => userController.getUsersByRole(req, res, next));

  /**
   * GET /api/v2/users/:userId
   * Get user profile by ID (admin or self)
   */
  router.get('/:userId', (req, res, next) => userController.getUser(req, res, next));

  /**
   * PUT /api/v2/users/:userId
   * Update user profile (admin only)
   * Body: { firstName?, lastName?, displayLanguage?, nativeLanguage? }
   */
  router.put('/:userId', (req, res, next) => userController.updateUser(req, res, next));

  /**
   * POST /api/v2/users/:userId/roles
   * Add role to user (admin only)
   * Body: { role }
   */
  router.post('/:userId/roles', (req, res, next) => userController.addRole(req, res, next));

  /**
   * DELETE /api/v2/users/:userId/roles/:role
   * Remove role from user (admin only)
   */
  router.delete('/:userId/roles/:role', (req, res, next) => userController.removeRole(req, res, next));

  /**
   * POST /api/v2/users/:userId/permissions
   * Add permission to user (admin only)
   * Body: { permission }
   */
  router.post('/:userId/permissions', (req, res, next) => userController.addPermission(req, res, next));

  /**
   * DELETE /api/v2/users/:userId/permissions/:permission
   * Remove permission from user (admin only)
   */
  router.delete('/:userId/permissions/:permission', (req, res, next) =>
    userController.removePermission(req, res, next)
  );

  /**
   * POST /api/v2/users/:userId/deactivate
   * Deactivate user account (admin only)
   */
  router.post('/:userId/deactivate', (req, res, next) => userController.deactivateUser(req, res, next));

  /**
   * POST /api/v2/users/:userId/activate
   * Activate user account (admin only)
   */
  router.post('/:userId/activate', (req, res, next) => userController.activateUser(req, res, next));

  return router;
}

module.exports = { createUserRoutes };
