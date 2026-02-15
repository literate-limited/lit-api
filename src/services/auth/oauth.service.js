/**
 * OAuth Service
 * Handles OAuth 2.0 flows (Google, GitHub, etc.) and SSO integration
 */

const { AuthenticationError, ConflictError, ValidationError } = require('../../errors/AppError');
const { generateToken, generateRefreshToken } = require('../../middleware/auth');

class OAuthService {
  constructor(coreUserDAL, userDAL) {
    this.coreUserDAL = coreUserDAL;
    this.userDAL = userDAL;
  }

  /**
   * Handle OAuth callback
   * Creates or updates user from OAuth provider data
   *
   * @param {Object} providerData - Data from OAuth provider
   * @param {string} providerData.provider - Provider name (google, github, microsoft, etc.)
   * @param {string} providerData.providerId - User ID from provider
   * @param {string} providerData.email - Email from provider
   * @param {string} providerData.firstName - First name from provider
   * @param {string} providerData.lastName - Last name from provider
   * @param {string} providerData.avatarUrl - Avatar URL from provider
   * @param {string} brandId - Brand ID
   * @returns {Promise<Object>} { user, coreUser, accessToken, refreshToken }
   */
  async handleOAuthCallback(providerData, brandId) {
    const { provider, providerId, email, firstName, lastName, avatarUrl } = providerData;

    if (!provider || !providerId || !email || !brandId) {
      throw new ValidationError('Missing required OAuth data', ['provider', 'providerId', 'email', 'brandId']);
    }

    try {
      // Find or create core user
      let coreUser = await this.coreUserDAL.findByEmail(email);

      if (!coreUser) {
        // Create new core user from OAuth data
        coreUser = await this.coreUserDAL.create({
          email,
          password_hash: null, // OAuth users don't have passwords initially
          first_name: firstName || '',
          last_name: lastName || '',
          avatar_url: avatarUrl || null,
          preferences: {}
        });

        // Verify email automatically for OAuth users
        await this.coreUserDAL.verifyEmail(coreUser.id);
      } else {
        // Update avatar if provided and not already set
        if (avatarUrl && !coreUser.avatar_url) {
          await this.coreUserDAL.updateProfile(coreUser.id, { avatar_url: avatarUrl });
          coreUser = await this.coreUserDAL.findById(coreUser.id);
        }
      }

      // Add OAuth provider to core user if not already added
      const existingProviderId = await this.coreUserDAL.getOAuthProviderId(coreUser.id, provider);
      if (!existingProviderId) {
        await this.coreUserDAL.addOAuthProvider(coreUser.id, provider, providerId);
      } else if (existingProviderId !== providerId) {
        throw new AuthenticationError('This provider is already linked to a different account', 'PROVIDER_CONFLICT');
      }

      // Find or create user account for this brand
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
        expiresIn: '7d',
        isNewUser: !await this.userDAL.findByCoreUserId(coreUser.id, brandId)
      };
    } catch (error) {
      if (error.statusCode) throw error;
      throw error;
    }
  }

  /**
   * Link OAuth provider to existing account
   * Allows adding additional OAuth providers to an account
   *
   * @param {string} coreUserId - Core user ID
   * @param {string} provider - Provider name
   * @param {string} providerId - User ID from provider
   * @param {Object} profileData - Profile data from provider
   * @returns {Promise<Object>} Updated core user
   */
  async linkOAuthProvider(coreUserId, provider, providerId, profileData = {}) {
    const coreUser = await this.coreUserDAL.findById(coreUserId);
    if (!coreUser) {
      throw new AuthenticationError('User not found', 'USER_NOT_FOUND');
    }

    // Check if provider already linked
    const existingProviderId = await this.coreUserDAL.getOAuthProviderId(coreUserId, provider);
    if (existingProviderId) {
      throw new ConflictError('This provider is already linked to your account', 'PROVIDER_ALREADY_LINKED');
    }

    // Check if this provider ID is used by another account
    const otherUser = await this.coreUserDAL.db.oneOrNone(
      `SELECT * FROM core_users WHERE auth_providers->$1 = $2`,
      [provider, JSON.stringify(providerId)]
    );

    if (otherUser && otherUser.id !== coreUserId) {
      throw new ConflictError('This provider is already linked to another account', 'PROVIDER_CONFLICT');
    }

    // Link provider
    const updatedCoreUser = await this.coreUserDAL.addOAuthProvider(coreUserId, provider, providerId);

    return updatedCoreUser;
  }

  /**
   * Unlink OAuth provider
   *
   * @param {string} coreUserId - Core user ID
   * @param {string} provider - Provider name
   * @returns {Promise<Object>} Updated core user
   */
  async unlinkOAuthProvider(coreUserId, provider) {
    const coreUser = await this.coreUserDAL.findById(coreUserId);
    if (!coreUser) {
      throw new AuthenticationError('User not found', 'USER_NOT_FOUND');
    }

    // Check if provider is linked
    const providerId = await this.coreUserDAL.getOAuthProviderId(coreUserId, provider);
    if (!providerId) {
      throw new ValidationError('This provider is not linked to your account', [provider]);
    }

    // Don't allow unlinking if no password is set (no other way to login)
    if (!coreUser.password_hash) {
      const authProviders = coreUser.auth_providers ? Object.keys(coreUser.auth_providers) : [];
      if (authProviders.length === 1) {
        throw new ValidationError('Cannot unlink your only authentication method. Please set a password first.', [provider]);
      }
    }

    // Remove provider from auth_providers
    const updatedCoreUser = await this.coreUserDAL.db.one(
      `UPDATE core_users
       SET auth_providers = auth_providers - $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [provider, coreUserId]
    );

    return updatedCoreUser;
  }

  /**
   * Get linked OAuth providers for user
   *
   * @param {string} coreUserId - Core user ID
   * @returns {Promise<Array>} Array of linked provider names
   */
  async getLinkedProviders(coreUserId) {
    const coreUser = await this.coreUserDAL.findById(coreUserId);
    if (!coreUser) {
      throw new AuthenticationError('User not found', 'USER_NOT_FOUND');
    }

    return coreUser.auth_providers ? Object.keys(coreUser.auth_providers) : [];
  }

  /**
   * Handle cross-brand SSO login
   * When user logs in via SSO to one brand, they can be auto-authenticated to another brand
   *
   * @param {string} coreUserId - Core user ID
   * @param {string} newBrandId - Target brand ID
   * @returns {Promise<Object>} { user, accessToken, refreshToken }
   */
  async handleCrossBrandSSO(coreUserId, newBrandId) {
    const coreUser = await this.coreUserDAL.findById(coreUserId);
    if (!coreUser) {
      throw new AuthenticationError('User not found', 'USER_NOT_FOUND');
    }

    // Find or create user for new brand
    const user = await this.userDAL.findOrCreateFromCoreUser(
      coreUserId,
      coreUser.email,
      newBrandId,
      {
        first_name: coreUser.first_name || '',
        last_name: coreUser.last_name || '',
        roles: ['student'],
        permissions: [],
        display_language: 'en'
      }
    );

    if (user.active === false) {
      throw new AuthenticationError('User account is deactivated', 'ACCOUNT_DEACTIVATED');
    }

    // Update last login
    await this.coreUserDAL.updateLastLogin(coreUserId, newBrandId);
    await this.userDAL.updateLastSeen(user.id, newBrandId);

    // Generate tokens for new brand
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
      accessToken,
      refreshToken,
      expiresIn: '7d',
      isNewToBrand: true
    };
  }
}

module.exports = OAuthService;
