/**
 * Authentication Controller
 * Handles HTTP requests for authentication endpoints
 */

const { ValidationError } = require('../../errors/AppError');

class AuthController {
  constructor(authService, oauthService) {
    this.authService = authService;
    this.oauthService = oauthService;
  }

  /**
   * POST /api/v2/auth/signup
   * Register new user
   */
  async signup(req, res, next) {
    try {
      const { email, password, firstName, lastName } = req.body;

      // Validate input
      if (!email || !password) {
        throw new ValidationError('Email and password are required', ['email', 'password']);
      }

      const result = await this.authService.signup({
        email,
        password,
        firstName: firstName || '',
        lastName: lastName || '',
        brandId: req.brandId
      });

      res.status(201).json({
        success: true,
        statusCode: 201,
        data: {
          user: {
            id: result.user.id,
            email: result.coreUser.email,
            firstName: result.coreUser.first_name,
            lastName: result.coreUser.last_name,
            roles: result.user.roles,
            onboardingStage: result.user.onboarding_stage
          },
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/login
   * Authenticate user with email and password
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new ValidationError('Email and password are required', ['email', 'password']);
      }

      const result = await this.authService.login({
        email,
        password,
        brandId: req.brandId
      });

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          user: {
            id: result.user.id,
            email: result.coreUser.email,
            firstName: result.coreUser.first_name,
            lastName: result.coreUser.last_name,
            avatar: result.coreUser.avatar_url,
            roles: result.user.roles,
            onboardingStage: result.user.onboarding_stage
          },
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/refresh
   * Refresh access token using refresh token
   */
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new ValidationError('Refresh token is required', ['refreshToken']);
      }

      const result = await this.authService.refreshAccessToken(refreshToken);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/logout
   * Logout user (requires authentication)
   */
  async logout(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      await this.authService.logout(req.userId, req.brandId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          message: 'Logged out successfully'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/verify-email
   * Send email verification (placeholder for email service integration)
   */
  async sendEmailVerification(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      // In production, this would send an email with verification link
      // For now, just return success

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          message: 'Verification email sent'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/verify-email/:token
   * Verify email with token from email link
   */
  async verifyEmail(req, res, next) {
    try {
      const { token } = req.params;

      if (!token) {
        throw new ValidationError('Verification token is required', ['token']);
      }

      // In production, decode token and extract coreUserId
      // For now, this is a placeholder

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          message: 'Email verified successfully'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/request-password-reset
   * Request password reset email
   */
  async requestPasswordReset(req, res, next) {
    try {
      const { email } = req.body;

      if (!email) {
        throw new ValidationError('Email is required', ['email']);
      }

      await this.authService.requestPasswordReset(email);

      // Always return success for security (don't reveal if email exists)
      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          message: 'If email exists, password reset link has been sent'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/reset-password
   * Reset password with reset token
   */
  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        throw new ValidationError('Token and new password are required', ['token', 'newPassword']);
      }

      // In production, decode token and extract coreUserId
      // For now, this is a placeholder

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          message: 'Password reset successfully'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/oauth/callback
   * Handle OAuth provider callback (Google, GitHub, etc.)
   */
  async oauthCallback(req, res, next) {
    try {
      const { provider, code, state } = req.body;

      if (!provider || !code) {
        throw new ValidationError('Provider and code are required', ['provider', 'code']);
      }

      // In production:
      // 1. Exchange code for provider tokens
      // 2. Get user profile from provider
      // 3. Call handleOAuthCallback

      // For now, this is a placeholder
      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          message: 'OAuth callback processed',
          accessToken: null,
          refreshToken: null
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/link-provider
   * Link OAuth provider to existing account
   */
  async linkProvider(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { provider, code } = req.body;

      if (!provider || !code) {
        throw new ValidationError('Provider and code are required', ['provider', 'code']);
      }

      // In production:
      // 1. Exchange code for provider tokens
      // 2. Get user profile from provider
      // 3. Call linkOAuthProvider

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          message: `${provider} provider linked successfully`
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v2/auth/unlink-provider/:provider
   * Unlink OAuth provider from account
   */
  async unlinkProvider(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { provider } = req.params;

      if (!provider) {
        throw new ValidationError('Provider is required', ['provider']);
      }

      await this.oauthService.unlinkOAuthProvider(req.coreUserId, provider);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          message: `${provider} provider unlinked successfully`
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v2/auth/providers
   * Get linked OAuth providers for authenticated user
   */
  async getLinkedProviders(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const providers = await this.oauthService.getLinkedProviders(req.coreUserId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          providers
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v2/auth/sso/login
   * Login to another brand via SSO (cross-brand authentication)
   */
  async ssoLogin(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { targetBrandId } = req.body;

      if (!targetBrandId) {
        throw new ValidationError('Target brand ID is required', ['targetBrandId']);
      }

      const result = await this.oauthService.handleCrossBrandSSO(req.coreUserId, targetBrandId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            roles: result.user.roles,
            onboardingStage: result.user.onboarding_stage
          },
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          isNewToBrand: result.isNewToBrand
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AuthController;
