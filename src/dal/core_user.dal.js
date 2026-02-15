/**
 * Core User Data Access Layer
 * Handles global user identity (cross-brand)
 */

const BaseDAL = require('./base.dal');

class CoreUserDAL extends BaseDAL {
  constructor(db) {
    super(db, 'core_users');
  }

  /**
   * Find by email (global, not brand-specific)
   */
  async findByEmail(email) {
    return this.db.oneOrNone(
      `SELECT * FROM core_users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
  }

  /**
   * Create new core user
   */
  async create(userData) {
    const {
      email,
      password_hash,
      first_name,
      last_name,
      avatar_url = null,
      bio = null,
      preferences = {}
    } = userData;

    return this.db.one(
      `INSERT INTO core_users (
        email, password_hash, first_name, last_name,
        avatar_url, bio, preferences, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *`,
      [email, password_hash, first_name, last_name, avatar_url, bio, JSON.stringify(preferences)]
    );
  }

  /**
   * Verify email
   */
  async verifyEmail(coreUserId) {
    return this.db.one(
      `UPDATE core_users
       SET email_verified = true, email_verified_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [coreUserId]
    );
  }

  /**
   * Update last login
   */
  async updateLastLogin(coreUserId, brandId = null) {
    return this.db.one(
      `UPDATE core_users
       SET last_login_at = NOW(),
           last_login_brand_id = $2,
           login_count = COALESCE(login_count, 0) + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [coreUserId, brandId]
    );
  }

  /**
   * Add OAuth provider
   */
  async addOAuthProvider(coreUserId, provider, providerId) {
    return this.db.one(
      `UPDATE core_users
       SET auth_providers = jsonb_set(
         COALESCE(auth_providers, '{}'::jsonb),
         $2::text[],
         to_jsonb($3::text)
       ),
       updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [coreUserId, `{${provider}}`, providerId]
    );
  }

  /**
   * Get OAuth provider ID
   */
  async getOAuthProviderId(coreUserId, provider) {
    const result = await this.db.oneOrNone(
      `SELECT auth_providers->$2 as provider_id FROM core_users WHERE id = $1`,
      [coreUserId, provider]
    );

    return result ? result.provider_id : null;
  }

  /**
   * Update profile
   */
  async updateProfile(coreUserId, profileData) {
    const {
      first_name,
      last_name,
      avatar_url,
      bio,
      preferences
    } = profileData;

    const updates = {};
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (bio !== undefined) updates.bio = bio;
    if (preferences !== undefined) updates.preferences = JSON.stringify(preferences);

    return this.update(coreUserId, updates, null);
  }

  /**
   * Override parent findById (no brand_id for core_users)
   */
  async findById(coreUserId) {
    return this.db.oneOrNone(
      `SELECT * FROM core_users WHERE id = $1`,
      [coreUserId]
    );
  }

  /**
   * Override parent create (no brand_id)
   */
  async create(data) {
    const fields = Object.keys(data);
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');

    return this.db.one(
      `INSERT INTO core_users (${fields.join(', ')}, created_at, updated_at)
       VALUES (${placeholders}, NOW(), NOW())
       RETURNING *`,
      Object.values(data)
    );
  }

  /**
   * Override parent update (no brand_id)
   */
  async update(coreUserId, updates) {
    if (Object.keys(updates).length === 0) {
      return this.findById(coreUserId);
    }

    const sets = Object.keys(updates)
      .map((key, i) => `${key} = $${i + 2}`)
      .join(', ');

    return this.db.one(
      `UPDATE core_users
       SET ${sets}, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [coreUserId, ...Object.values(updates)]
    );
  }

  /**
   * Override parent delete (no brand_id)
   */
  async delete(coreUserId, soft = true) {
    if (soft) {
      return this.db.one(
        `UPDATE core_users
         SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [coreUserId]
      );
    }

    return this.db.oneOrNone(
      `DELETE FROM core_users WHERE id = $1 RETURNING *`,
      [coreUserId]
    );
  }
}

module.exports = CoreUserDAL;
