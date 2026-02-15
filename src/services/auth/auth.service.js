/**
 * Authentication Service
 * Core authentication business logic: signup, login, token management
 */

const { AuthenticationError, ConflictError, ValidationError } = require('../../errors/AppError');
const { generateToken, generateRefreshToken, verifyRefreshToken } = require('../../middleware/auth');
const PasswordService = require('./password.service');

class AuthService {
  constructor(coreUserDAL, userDAL) {
    this.coreUserDAL = coreUserDAL;
    this.userDAL = userDAL;
  }

  /**
   * Sign up new user
   * Creates both CoreUser (global) and User (brand-specific) records
   *
   * @param {Object} credentials
   * @param {string} credentials.email - User email
   * @param {string} credentials.password - Plain text password
   * @param {string} credentials.firstName - First name
   * @param {string} credentials.lastName - Last name
   * @param {string} credentials.brandId - Brand ID
   * @returns {Promise<Object>} { user, coreUser, accessToken, refreshToken }
   */
  async signup(credentials) {
    const { email, password, firstName, lastName, brandId } = credentials;

    // Validate input
    if (!email || !password || !brandId) {
      throw new ValidationError('Email, password, and brand are required', ['email', 'password', 'brandId']);
    }

    // Check password strength
    const passwordValidation = PasswordService.validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      throw new ValidationError('Password does not meet requirements', passwordValidation.errors);
    }

    // Check if email already exists (globally)
    const existingCoreUser = await this.coreUserDAL.findByEmail(email);
    if (existingCoreUser) {
      throw new ConflictError('Email already registered', 'EMAIL_EXISTS');
    }

    try {
      // Hash password
      const passwordHash = await PasswordService.hashPassword(password);

      // Create core user (global identity)
      const coreUser = await this.coreUserDAL.create({
        email,
        password_hash: passwordHash,
        first_name: firstName || '',
        last_name: lastName || '',
        preferences: {}
      });

      // Create user account for this brand
      const user = await this.userDAL.findOrCreateFromCoreUser(
        coreUser.id,
        email,
        brandId,
        {
          first_name: firstName || '',
          last_name: lastName || '',
          roles: ['student'],
          permissions: [],
          display_language: 'en'
        }
      );

      // Generate tokens
      const accessToken = generateToken({
        userId: user.id,
        coreUserId: coreUser.id,
        email: coreUser.email,
        roles: user.roles || [],
        brandId: user.brand_id
      });

      const refreshToken = generateRefreshToken({
        userId: user.id,
        coreUserId: coreUser.id,
        brandId: user.brand_id
      });

      return {
        user,
        coreUser,
        accessToken,
        refreshToken,
        expiresIn: '7d'
      };
    } catch (error) {
      // Re-throw if it's already an AppError
      if (error.statusCode) throw error;
      throw error;
    }
  }

  /**
   * Login user
   * Verifies credentials and returns tokens
   *
   * @param {Object} credentials
   * @param {string} credentials.email - User email
   * @param {string} credentials.password - Plain text password
   * @param {string} credentials.brandId - Brand ID
   * @returns {Promise<Object>} { user, coreUser, accessToken, refreshToken }
   */
  async login(credentials) {
    const { email, password, brandId } = credentials;

    // Validate input
    if (!email || !password || !brandId) {
      throw new AuthenticationError('Email, password, and brand are required');
    }

    // Find core user by email
    const coreUser = await this.coreUserDAL.findByEmail(email);
    if (!coreUser) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await PasswordService.comparePassword(password, coreUser.password_hash);
    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Find or create user for this brand
    const user = await this.userDAL.findOrCreateFromCoreUser(
      coreUser.id,
      email,
      brandId,
      {
        first_name: coreUser.first_name || '',
        last_name: coreUser.last_name || '',
        roles: ['student'],
        permissions: [],
        display_language: 'en'
      }
    );

    // Check if user is active
    if (user.active === false) {
      throw new AuthenticationError('User account is deactivated', 'ACCOUNT_DEACTIVATED');
    }

    // Update last login
    await this.coreUserDAL.updateLastLogin(coreUser.id, brandId);
    await this.userDAL.updateLastSeen(user.id, brandId);

    // Generate tokens
    const accessToken = generateToken({
      userId: user.id,
      coreUserId: coreUser.id,
      email: coreUser.email,
      roles: user.roles || [],
      brandId: user.brand_id
    });

    const refreshToken = generateRefreshToken({
      userId: user.id,
      coreUserId: coreUser.id,
      brandId: user.brand_id
    });

    return {
      user,
      coreUser,
      accessToken,
      refreshToken,
      expiresIn: '7d'
    };
  }

  /**
   * Refresh access token
   *
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} { accessToken, refreshToken }
   */
  async refreshAccessToken(refreshToken) {
    try {
      // Verify refresh token
      const decoded = verifyRefreshToken(refreshToken);

      // Get user data to create new token
      const user = await this.userDAL.findById(decoded.userId, decoded.brandId);
      if (!user || !user.active) {
        throw new AuthenticationError('User not found or account is inactive');
      }

      const coreUser = await this.coreUserDAL.findById(decoded.coreUserId);
      if (!coreUser) {
        throw new AuthenticationError('Core user not found');
      }

      // Generate new tokens
      const newAccessToken = generateToken({
        userId: user.id,
        coreUserId: coreUser.id,
        email: coreUser.email,
        roles: user.roles || [],
        brandId: user.brand_id
      });

      const newRefreshToken = generateRefreshToken({
        userId: user.id,
        coreUserId: coreUser.id,
        brandId: user.brand_id
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: '7d'
      };
    } catch (error) {
      if (error.statusCode) throw error;
      throw new AuthenticationError('Failed to refresh token');
    }
  }

  /**
   * Verify email address
   *
   * @param {string} coreUserId - Core user ID
   * @returns {Promise<Object>} Updated core user
   */
  async verifyEmail(coreUserId) {
    const coreUser = await this.coreUserDAL.verifyEmail(coreUserId);
    return coreUser;
  }

  /**
   * Request password reset
   * In production, this would send an email with reset token
   *
   * @param {string} email - User email
   * @returns {Promise<Object>} { success: true, message: string }
   */
  async requestPasswordReset(email) {
    const coreUser = await this.coreUserDAL.findByEmail(email);

    if (!coreUser) {
      // For security, don't reveal if email exists
      return { success: true, message: 'If email exists, reset link has been sent' };
    }

    // In production:
    // 1. Generate reset token
    // 2. Store in database with expiration
    // 3. Send email with reset link
    // 4. Return success

    return { success: true, message: 'Password reset link has been sent to your email' };
  }

  /**
   * Reset password with reset token
   *
   * @param {Object} resetData
   * @param {string} resetData.coreUserId - Core user ID
   * @param {string} resetData.newPassword - New password
   * @returns {Promise<Object>} Updated core user
   */
  async resetPassword(resetData) {
    const { coreUserId, newPassword } = resetData;

    // Validate password strength
    const passwordValidation = PasswordService.validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      throw new ValidationError('Password does not meet requirements', passwordValidation.errors);
    }

    // Hash new password
    const passwordHash = await PasswordService.hashPassword(newPassword);

    // Update password
    const coreUser = await this.coreUserDAL.update(coreUserId, {
      password_hash: passwordHash
    });

    return coreUser;
  }

  /**
   * Logout (server-side token invalidation could happen here)
   * With JWT, logout is typically client-side, but this could trigger cleanup
   *
   * @param {string} userId - Brand-specific user ID
   * @param {string} brandId - Brand ID
   * @returns {Promise<Object>} Success response
   */
  async logout(userId, brandId) {
    // Update last activity
    await this.userDAL.updateLastSeen(userId, brandId);

    // In production, could add token to blacklist (Redis)
    return { success: true, message: 'Logged out successfully' };
  }
}

module.exports = AuthService;
