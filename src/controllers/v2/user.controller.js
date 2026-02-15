/**
 * User Controller
 * Handles HTTP requests for user management endpoints
 */

const { ValidationError, AuthorizationError } = require('../../errors/AppError');

class UserController {
  constructor(userService) {
    this.userService = userService;
  }

  /**
   * GET /api/v2/users/me
   * Get current user profile
   */
  async getCurrentUser(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const user = await this.userService.getUser(req.userId, req.brandId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          roles: user.roles,
          permissions: user.permissions,
          onboardingStage: user.onboarding_stage,
          nativeLanguage: user.native_language,
          displayLanguage: user.display_language,
          lastSeenAt: user.last_seen_at,
          createdAt: user.created_at,
          active: user.active
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
   * GET /api/v2/users/:userId
   * Get user profile by ID (admin only)
   */
  async getUser(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { userId } = req.params;

      // Check admin permission
      const isAdmin = await this.userService.hasRole(req.userId, 'admin', req.brandId);
      if (!isAdmin && userId !== req.userId) {
        throw new AuthorizationError('Permission denied', 'INSUFFICIENT_PERMISSION');
      }

      const user = await this.userService.getUser(userId, req.brandId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          roles: user.roles,
          permissions: user.permissions,
          onboardingStage: user.onboarding_stage,
          nativeLanguage: user.native_language,
          displayLanguage: user.display_language,
          lastSeenAt: user.last_seen_at,
          createdAt: user.created_at,
          active: user.active
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
   * PUT /api/v2/users/me
   * Update current user profile
   */
  async updateCurrentUser(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { firstName, lastName, displayLanguage, nativeLanguage, metadata } = req.body;

      const updates = {};
      if (firstName !== undefined) updates.first_name = firstName;
      if (lastName !== undefined) updates.last_name = lastName;
      if (displayLanguage !== undefined) updates.display_language = displayLanguage;
      if (nativeLanguage !== undefined) updates.native_language = nativeLanguage;
      if (metadata !== undefined) updates.metadata = metadata;

      const updatedUser = await this.userService.updateUser(req.userId, req.brandId, updates);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: updatedUser.id,
          email: updatedUser.email,
          firstName: updatedUser.first_name,
          lastName: updatedUser.last_name,
          displayLanguage: updatedUser.display_language,
          nativeLanguage: updatedUser.native_language,
          metadata: updatedUser.metadata,
          updatedAt: updatedUser.updated_at
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
   * PUT /api/v2/users/:userId
   * Update user profile (admin only)
   */
  async updateUser(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { userId } = req.params;
      const { firstName, lastName, displayLanguage, nativeLanguage } = req.body;

      // Check admin permission
      const isAdmin = await this.userService.hasRole(req.userId, 'admin', req.brandId);
      if (!isAdmin) {
        throw new AuthorizationError('Only administrators can update other users', 'INSUFFICIENT_PERMISSION');
      }

      const updates = {};
      if (firstName !== undefined) updates.first_name = firstName;
      if (lastName !== undefined) updates.last_name = lastName;
      if (displayLanguage !== undefined) updates.display_language = displayLanguage;
      if (nativeLanguage !== undefined) updates.native_language = nativeLanguage;

      const updatedUser = await this.userService.updateUser(userId, req.brandId, updates);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: updatedUser.id,
          email: updatedUser.email,
          firstName: updatedUser.first_name,
          lastName: updatedUser.last_name,
          displayLanguage: updatedUser.display_language,
          nativeLanguage: updatedUser.native_language
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
   * POST /api/v2/users/me/onboarding
   * Update onboarding stage
   */
  async updateOnboardingStage(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { stage } = req.body;

      if (!stage) {
        throw new ValidationError('Onboarding stage is required', ['stage']);
      }

      const updatedUser = await this.userService.updateOnboardingStage(req.userId, stage, req.brandId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: updatedUser.id,
          onboardingStage: updatedUser.onboarding_stage,
          onboardingCompletedAt: updatedUser.onboarding_completed_at
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
   * POST /api/v2/users/:userId/roles
   * Add role to user (admin only)
   */
  async addRole(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { userId } = req.params;
      const { role } = req.body;

      if (!role) {
        throw new ValidationError('Role is required', ['role']);
      }

      const updatedUser = await this.userService.addRole(userId, role, req.brandId, req.userId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: updatedUser.id,
          roles: updatedUser.roles
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
   * DELETE /api/v2/users/:userId/roles/:role
   * Remove role from user (admin only)
   */
  async removeRole(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { userId, role } = req.params;

      if (!role) {
        throw new ValidationError('Role is required', ['role']);
      }

      const updatedUser = await this.userService.removeRole(userId, role, req.brandId, req.userId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: updatedUser.id,
          roles: updatedUser.roles
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
   * POST /api/v2/users/:userId/permissions
   * Add permission to user (admin only)
   */
  async addPermission(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { userId } = req.params;
      const { permission } = req.body;

      if (!permission) {
        throw new ValidationError('Permission is required', ['permission']);
      }

      const isAdmin = await this.userService.hasRole(req.userId, 'admin', req.brandId);
      if (!isAdmin) {
        throw new AuthorizationError('Only administrators can add permissions', 'INSUFFICIENT_PERMISSION');
      }

      const updatedUser = await this.userService.addPermission(userId, permission, req.brandId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: updatedUser.id,
          permissions: updatedUser.permissions
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
   * DELETE /api/v2/users/:userId/permissions/:permission
   * Remove permission from user (admin only)
   */
  async removePermission(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { userId, permission } = req.params;

      if (!permission) {
        throw new ValidationError('Permission is required', ['permission']);
      }

      const isAdmin = await this.userService.hasRole(req.userId, 'admin', req.brandId);
      if (!isAdmin) {
        throw new AuthorizationError('Only administrators can remove permissions', 'INSUFFICIENT_PERMISSION');
      }

      const updatedUser = await this.userService.removePermission(userId, permission, req.brandId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: updatedUser.id,
          permissions: updatedUser.permissions
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
   * GET /api/v2/users/search
   * Get users by role (admin only)
   * Query: { role, limit?, offset? }
   */
  async getUsersByRole(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const isAdmin = await this.userService.hasRole(req.userId, 'admin', req.brandId);
      if (!isAdmin) {
        throw new AuthorizationError('Only administrators can query users', 'INSUFFICIENT_PERMISSION');
      }

      const { role, limit = 20, offset = 0 } = req.query;

      if (!role) {
        throw new ValidationError('Role query parameter is required', ['role']);
      }

      const result = await this.userService.getUsersByRole(role, req.brandId, {
        limit: Math.min(parseInt(limit), 100),
        offset: parseInt(offset)
      });

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          users: result.rows.map(u => ({
            id: u.id,
            email: u.email,
            firstName: u.first_name,
            lastName: u.last_name,
            roles: u.roles,
            lastSeenAt: u.last_seen_at,
            createdAt: u.created_at
          })),
          pagination: {
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            pages: Math.ceil(result.total / result.limit)
          }
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
   * POST /api/v2/users/:userId/deactivate
   * Deactivate user account (admin only)
   */
  async deactivateUser(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { userId } = req.params;

      const deactivatedUser = await this.userService.deactivateUser(userId, req.brandId, req.userId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: deactivatedUser.id,
          active: deactivatedUser.active
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
   * POST /api/v2/users/:userId/activate
   * Activate user account (admin only)
   */
  async activateUser(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const { userId } = req.params;

      const activatedUser = await this.userService.reactivateUser(userId, req.brandId, req.userId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: {
          id: activatedUser.id,
          active: activatedUser.active
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
   * GET /api/v2/users/me/activity
   * Get current user activity
   */
  async getCurrentUserActivity(req, res, next) {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required', ['authorization']);
      }

      const activity = await this.userService.getUserActivity(req.userId, req.brandId);

      res.status(200).json({
        success: true,
        statusCode: 200,
        data: activity,
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = UserController;
