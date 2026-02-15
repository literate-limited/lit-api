/**
 * Authentication Routes
 * All auth endpoints (v2 API)
 */

const express = require('express');
const { authMiddleware, optionalAuthMiddleware } = require('../../middleware/auth');

/**
 * Create auth routes
 * @param {AuthController} authController - Auth controller instance
 * @returns {express.Router} Express router with auth routes
 */
function createAuthRoutes(authController) {
  const router = express.Router();

  /**
   * Public Routes (no authentication required)
   */

  /**
   * POST /api/v2/auth/signup
   * Register new user
   * Body: { email, password, firstName?, lastName? }
   */
  router.post('/signup', (req, res, next) => authController.signup(req, res, next));

  /**
   * POST /api/v2/auth/login
   * Authenticate with email and password
   * Body: { email, password }
   */
  router.post('/login', (req, res, next) => authController.login(req, res, next));

  /**
   * POST /api/v2/auth/refresh
   * Refresh access token
   * Body: { refreshToken }
   */
  router.post('/refresh', (req, res, next) => authController.refreshToken(req, res, next));

  /**
   * POST /api/v2/auth/request-password-reset
   * Request password reset email
   * Body: { email }
   */
  router.post('/request-password-reset', (req, res, next) =>
    authController.requestPasswordReset(req, res, next)
  );

  /**
   * POST /api/v2/auth/reset-password
   * Reset password with token
   * Body: { token, newPassword }
   */
  router.post('/reset-password', (req, res, next) => authController.resetPassword(req, res, next));

  /**
   * POST /api/v2/auth/verify-email/:token
   * Verify email with token
   * Params: { token }
   */
  router.post('/verify-email/:token', (req, res, next) => authController.verifyEmail(req, res, next));

  /**
   * OAuth Routes
   */

  /**
   * POST /api/v2/auth/oauth/callback
   * Handle OAuth provider callback
   * Body: { provider, code, state? }
   */
  router.post('/oauth/callback', (req, res, next) => authController.oauthCallback(req, res, next));

  /**
   * Protected Routes (authentication required)
   */

  /**
   * POST /api/v2/auth/logout
   * Logout user
   * Headers: { Authorization: Bearer <token> }
   */
  router.post('/logout', authMiddleware, (req, res, next) => authController.logout(req, res, next));

  /**
   * POST /api/v2/auth/verify-email
   * Send email verification
   * Headers: { Authorization: Bearer <token> }
   */
  router.post('/verify-email', authMiddleware, (req, res, next) =>
    authController.sendEmailVerification(req, res, next)
  );

  /**
   * POST /api/v2/auth/link-provider
   * Link OAuth provider to account
   * Headers: { Authorization: Bearer <token> }
   * Body: { provider, code }
   */
  router.post('/link-provider', authMiddleware, (req, res, next) =>
    authController.linkProvider(req, res, next)
  );

  /**
   * DELETE /api/v2/auth/unlink-provider/:provider
   * Unlink OAuth provider
   * Headers: { Authorization: Bearer <token> }
   * Params: { provider }
   */
  router.delete('/unlink-provider/:provider', authMiddleware, (req, res, next) =>
    authController.unlinkProvider(req, res, next)
  );

  /**
   * GET /api/v2/auth/providers
   * Get linked OAuth providers
   * Headers: { Authorization: Bearer <token> }
   */
  router.get('/providers', authMiddleware, (req, res, next) =>
    authController.getLinkedProviders(req, res, next)
  );

  /**
   * POST /api/v2/auth/sso/login
   * Login to another brand via SSO
   * Headers: { Authorization: Bearer <token> }
   * Body: { targetBrandId }
   */
  router.post('/sso/login', authMiddleware, (req, res, next) =>
    authController.ssoLogin(req, res, next)
  );

  return router;
}

module.exports = { createAuthRoutes };
