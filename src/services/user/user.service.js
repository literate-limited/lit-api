/**
 * User Service
 * Handles user profile and account management
 */

const { NotFoundError, ValidationError, AuthorizationError } = require('../../errors/AppError');

class UserService {
  constructor(userDAL, coreUserDAL) {
    this.userDAL = userDAL;
    this.coreUserDAL = coreUserDAL;
  }

  /**
   * Get user profile
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} brandId - Brand ID
   * @returns {Promise<Object>} User object
   */
  async getUser(userId, brandId) {
    const user = await this.userDAL.findById(userId, brandId);

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    return user;
  }

  /**
   * Get user with core user data
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} brandId - Brand ID
   * @returns {Promise<Object>} User object with core user data joined
   */
  async getUserWithCoreUser(userId, brandId, db) {
    const user = await this.userDAL.findWithCoreUser(userId, brandId, db);

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    return user;
  }

  /**
   * Update user profile
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} brandId - Brand ID
   * @param {Object} updates - Fields to update (first_name, last_name, display_language, metadata)
   * @returns {Promise<Object>} Updated user
   */
  async updateUser(userId, brandId, updates) {
    const user = await this.userDAL.findById(userId, brandId);

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    // Filter allowed fields
    const allowedFields = ['first_name', 'last_name', 'display_language', 'metadata', 'native_language'];
    const safeUpdates = {};

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        safeUpdates[key] = value;
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return user;
    }

    const updatedUser = await this.userDAL.update(userId, safeUpdates, brandId);
    return updatedUser;
  }

  /**
   * Update core user profile (global user data)
   *
   * @param {string} coreUserId - Global user ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated core user
   */
  async updateCoreUserProfile(coreUserId, updates) {
    const allowedFields = ['first_name', 'last_name', 'avatar_url', 'bio', 'preferences'];
    const safeUpdates = {};

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        safeUpdates[key] = value;
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return this.coreUserDAL.findById(coreUserId);
    }

    const updatedCoreUser = await this.coreUserDAL.updateProfile(coreUserId, safeUpdates);
    return updatedCoreUser;
  }

  /**
   * Update user onboarding stage
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} stage - Onboarding stage (needs, started, completed)
   * @param {string} brandId - Brand ID
   * @returns {Promise<Object>} Updated user
   */
  async updateOnboardingStage(userId, stage, brandId) {
    const validStages = ['needs', 'started', 'completed'];

    if (!validStages.includes(stage)) {
      throw new ValidationError('Invalid onboarding stage', [`Stage must be one of: ${validStages.join(', ')}`]);
    }

    const user = await this.userDAL.updateOnboardingStage(userId, stage, brandId);
    return user;
  }

  /**
   * Add role to user
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} role - Role to add
   * @param {string} brandId - Brand ID
   * @param {string} requestingUserId - ID of user making the request (for authorization)
   * @returns {Promise<Object>} Updated user
   */
  async addRole(userId, role, brandId, requestingUserId) {
    // Check authorization (only admins can add roles)
    const requestingUser = await this.userDAL.findById(requestingUserId, brandId);
    if (!requestingUser || !requestingUser.roles.includes('admin')) {
      throw new AuthorizationError('Only administrators can add roles', 'INSUFFICIENT_PERMISSION');
    }

    const user = await this.userDAL.findById(userId, brandId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const updatedUser = await this.userDAL.addRole(userId, role, brandId);
    return updatedUser;
  }

  /**
   * Remove role from user
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} role - Role to remove
   * @param {string} brandId - Brand ID
   * @param {string} requestingUserId - ID of user making the request (for authorization)
   * @returns {Promise<Object>} Updated user
   */
  async removeRole(userId, role, brandId, requestingUserId) {
    // Check authorization
    const requestingUser = await this.userDAL.findById(requestingUserId, brandId);
    if (!requestingUser || !requestingUser.roles.includes('admin')) {
      throw new AuthorizationError('Only administrators can remove roles', 'INSUFFICIENT_PERMISSION');
    }

    const user = await this.userDAL.findById(userId, brandId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const updatedUser = await this.userDAL.removeRole(userId, role, brandId);
    return updatedUser;
  }

  /**
   * Add permission to user
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} permission - Permission to add
   * @param {string} brandId - Brand ID
   * @returns {Promise<Object>} Updated user
   */
  async addPermission(userId, permission, brandId) {
    const user = await this.userDAL.findById(userId, brandId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const updatedUser = await this.userDAL.addPermission(userId, permission, brandId);
    return updatedUser;
  }

  /**
   * Remove permission from user
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} permission - Permission to remove
   * @param {string} brandId - Brand ID
   * @returns {Promise<Object>} Updated user
   */
  async removePermission(userId, permission, brandId) {
    const user = await this.userDAL.findById(userId, brandId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const updatedUser = await this.userDAL.removePermission(userId, permission, brandId);
    return updatedUser;
  }

  /**
   * Check if user has role
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} role - Role to check
   * @param {string} brandId - Brand ID
   * @returns {Promise<boolean>} True if user has role
   */
  async hasRole(userId, role, brandId) {
    return this.userDAL.hasRole(userId, role, brandId);
  }

  /**
   * Check if user has permission
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} permission - Permission to check
   * @param {string} brandId - Brand ID
   * @returns {Promise<boolean>} True if user has permission
   */
  async hasPermission(userId, permission, brandId) {
    return this.userDAL.hasPermission(userId, permission, brandId);
  }

  /**
   * Get users by role
   *
   * @param {string} role - Role to filter by
   * @param {string} brandId - Brand ID
   * @param {Object} options - Query options (limit, offset)
   * @returns {Promise<Object>} Paginated list of users with role
   */
  async getUsersByRole(role, brandId, options = {}) {
    return this.userDAL.findByRole(role, brandId, options);
  }

  /**
   * Deactivate user account
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} brandId - Brand ID
   * @param {string} requestingUserId - ID of user making the request
   * @returns {Promise<Object>} Updated user
   */
  async deactivateUser(userId, brandId, requestingUserId) {
    // Check authorization
    const requestingUser = await this.userDAL.findById(requestingUserId, brandId);
    if (!requestingUser || !requestingUser.roles.includes('admin')) {
      throw new AuthorizationError('Only administrators can deactivate users', 'INSUFFICIENT_PERMISSION');
    }

    if (userId === requestingUserId) {
      throw new ValidationError('Cannot deactivate your own account', ['userId']);
    }

    const user = await this.userDAL.findById(userId, brandId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const updatedUser = await this.userDAL.deactivate(userId, brandId);
    return updatedUser;
  }

  /**
   * Reactivate user account
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} brandId - Brand ID
   * @param {string} requestingUserId - ID of user making the request
   * @returns {Promise<Object>} Updated user
   */
  async reactivateUser(userId, brandId, requestingUserId) {
    // Check authorization
    const requestingUser = await this.userDAL.findById(requestingUserId, brandId);
    if (!requestingUser || !requestingUser.roles.includes('admin')) {
      throw new AuthorizationError('Only administrators can reactivate users', 'INSUFFICIENT_PERMISSION');
    }

    const user = await this.userDAL.findById(userId, brandId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const updatedUser = await this.userDAL.activate(userId, brandId);
    return updatedUser;
  }

  /**
   * Get user activity status
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} brandId - Brand ID
   * @returns {Promise<Object>} User activity data
   */
  async getUserActivity(userId, brandId) {
    const user = await this.userDAL.findById(userId, brandId);

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    return {
      userId: user.id,
      lastSeenAt: user.last_seen_at,
      onboardingStage: user.onboarding_stage,
      onboardingCompletedAt: user.onboarding_completed_at,
      active: user.active,
      createdAt: user.created_at
    };
  }
}

module.exports = UserService;
