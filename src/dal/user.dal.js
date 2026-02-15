/**
 * User Data Access Layer
 * Handles brand-specific user accounts (one user can have multiple brand accounts)
 */

const BaseDAL = require('./base.dal');

class UserDAL extends BaseDAL {
  constructor(db) {
    super(db, 'users');
  }

  /**
   * Find by email (brand-specific)
   */
  async findByEmail(email, brandId) {
    return this.db.oneOrNone(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND brand_id = $2`,
      [email, brandId]
    );
  }

  /**
   * Find by core_user_id (brand-specific)
   * Returns user account for this brand created from a core user
   */
  async findByCoreUserId(coreUserId, brandId) {
    return this.db.oneOrNone(
      `SELECT * FROM users WHERE core_user_id = $1 AND brand_id = $2`,
      [coreUserId, brandId]
    );
  }

  /**
   * Find or create user from core user
   * If user doesn't exist for this brand, create one
   */
  async findOrCreateFromCoreUser(coreUserId, email, brandId, userData = {}) {
    // Try to find existing
    let user = await this.findByCoreUserId(coreUserId, brandId);

    if (!user) {
      // Create new user for this brand
      const {
        first_name = '',
        last_name = '',
        roles = ['student'],
        permissions = [],
        native_language = null,
        display_language = 'en',
        metadata = {}
      } = userData;

      user = await this.create({
        core_user_id: coreUserId,
        email,
        first_name,
        last_name,
        roles,
        permissions,
        native_language,
        display_language,
        metadata,
        onboarding_stage: 'needs'
      }, brandId);
    }

    return user;
  }

  /**
   * Find user with core user data
   */
  async findWithCoreUser(userId, brandId, db) {
    return db.oneOrNone(
      `SELECT
        u.*,
        cu.email as core_user_email,
        cu.first_name as core_user_first_name,
        cu.last_name as core_user_last_name,
        cu.email_verified,
        cu.avatar_url,
        cu.last_login_at
      FROM users u
      JOIN core_users cu ON u.core_user_id = cu.id
      WHERE u.id = $1 AND u.brand_id = $2`,
      [userId, brandId]
    );
  }

  /**
   * Get users by role
   */
  async findByRole(role, brandId, options = {}) {
    const { limit = 20, offset = 0 } = options;

    const rows = await this.db.many(
      `SELECT * FROM users
       WHERE brand_id = $1 AND $2 = ANY(roles)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [brandId, role, limit, offset]
    );

    const countResult = await this.db.one(
      `SELECT COUNT(*) as total FROM users WHERE brand_id = $1 AND $2 = ANY(roles)`,
      [brandId, role]
    );

    return {
      rows,
      total: parseInt(countResult.total, 10),
      limit,
      offset
    };
  }

  /**
   * Update onboarding stage
   */
  async updateOnboardingStage(userId, stage, brandId) {
    return this.db.one(
      `UPDATE users
       SET onboarding_stage = $1,
           ${stage === 'complete' ? 'onboarding_completed_at = NOW(),' : ''}
           updated_at = NOW()
       WHERE id = $2 AND brand_id = $3
       RETURNING *`,
      [stage, userId, brandId]
    );
  }

  /**
   * Update last seen
   */
  async updateLastSeen(userId, brandId) {
    return this.db.one(
      `UPDATE users
       SET last_seen_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND brand_id = $2
       RETURNING *`,
      [userId, brandId]
    );
  }

  /**
   * Add permission
   */
  async addPermission(userId, permission, brandId) {
    return this.db.one(
      `UPDATE users
       SET permissions = array_append(COALESCE(permissions, ARRAY[]::text[]), $1),
           updated_at = NOW()
       WHERE id = $2 AND brand_id = $3 AND NOT ($1 = ANY(permissions))
       RETURNING *`,
      [permission, userId, brandId]
    );
  }

  /**
   * Remove permission
   */
  async removePermission(userId, permission, brandId) {
    return this.db.one(
      `UPDATE users
       SET permissions = array_remove(COALESCE(permissions, ARRAY[]::text[]), $1),
           updated_at = NOW()
       WHERE id = $2 AND brand_id = $3
       RETURNING *`,
      [permission, userId, brandId]
    );
  }

  /**
   * Add role
   */
  async addRole(userId, role, brandId) {
    return this.db.one(
      `UPDATE users
       SET roles = array_append(COALESCE(roles, ARRAY[]::text[]), $1),
           updated_at = NOW()
       WHERE id = $2 AND brand_id = $3 AND NOT ($1 = ANY(roles))
       RETURNING *`,
      [role, userId, brandId]
    );
  }

  /**
   * Remove role
   */
  async removeRole(userId, role, brandId) {
    return this.db.one(
      `UPDATE users
       SET roles = array_remove(COALESCE(roles, ARRAY[]::text[]), $1),
           updated_at = NOW()
       WHERE id = $2 AND brand_id = $3
       RETURNING *`,
      [role, userId, brandId]
    );
  }

  /**
   * Update metadata
   */
  async updateMetadata(userId, brandId, metadata) {
    return this.db.one(
      `UPDATE users
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         ARRAY['metadata'],
         to_jsonb($1::jsonb)
       ),
       updated_at = NOW()
       WHERE id = $2 AND brand_id = $3
       RETURNING *`,
      [JSON.stringify(metadata), userId, brandId]
    );
  }

  /**
   * Check if user has role
   */
  async hasRole(userId, role, brandId) {
    const result = await this.db.oneOrNone(
      `SELECT EXISTS(
        SELECT 1 FROM users
        WHERE id = $1 AND brand_id = $2 AND $3 = ANY(roles)
      ) as has_role`,
      [userId, brandId, role]
    );

    return result ? result.has_role : false;
  }

  /**
   * Check if user has permission
   */
  async hasPermission(userId, permission, brandId) {
    const result = await this.db.oneOrNone(
      `SELECT EXISTS(
        SELECT 1 FROM users
        WHERE id = $1 AND brand_id = $2 AND $3 = ANY(permissions)
      ) as has_permission`,
      [userId, brandId, permission]
    );

    return result ? result.has_permission : false;
  }

  /**
   * Deactivate user account for brand
   */
  async deactivate(userId, brandId) {
    return this.db.one(
      `UPDATE users
       SET active = false, updated_at = NOW()
       WHERE id = $1 AND brand_id = $2
       RETURNING *`,
      [userId, brandId]
    );
  }

  /**
   * Reactivate user account for brand
   */
  async activate(userId, brandId) {
    return this.db.one(
      `UPDATE users
       SET active = true, updated_at = NOW()
       WHERE id = $1 AND brand_id = $2
       RETURNING *`,
      [userId, brandId]
    );
  }
}

module.exports = UserDAL;
