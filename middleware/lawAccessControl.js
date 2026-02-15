import db from '../db.js';
import { logAccessDenial } from './lawAudit.js';

/**
 * Law Access Control Middleware
 *
 * Enforces attorney-client privilege by controlling who can view/edit consultations
 *
 * Access Rules:
 * 1. Owner has full access to their consultations
 * 2. Explicit access grants (stored in law_consultation_access table)
 * 3. Access levels: 'read' (view only), 'write' (edit messages), 'admin' (full control)
 * 4. Optional expiration on access grants
 *
 * Usage in routes:
 * router.get('/consultations/:id', requireConsultationAccess('read'), ...)
 * router.post('/consultations/:id/chat', requireConsultationAccess('write'), ...)
 */

/**
 * Create middleware to require consultation access at specified level
 * @param {string} requiredLevel - Required access level: 'read', 'write', or 'admin'
 * @returns {Function} - Express middleware
 */
export function requireConsultationAccess(requiredLevel = 'read') {
  return async (req, res, next) => {
    try {
      const consultationId = req.params.consultationId || req.params.id;

      if (!consultationId) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Consultation ID required in URL params'
        });
      }

      if (!req.user) {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      // Check access permission
      const hasAccess = await checkConsultationAccess(
        consultationId,
        req.user.userId,
        requiredLevel,
        req.brandId
      );

      if (!hasAccess) {
        // Log the access denial
        await logAccessDenial(req.brandId, req.user.userId, consultationId, req);

        return res.status(403).json({
          error: 'FORBIDDEN',
          message: `Insufficient permissions (requires ${requiredLevel} access to consultation)`
        });
      }

      // Attach consultation ID to request for later use
      req.consultationId = consultationId;

      next();
    } catch (error) {
      console.error('Access control error:', error);
      return res.status(500).json({
        error: 'ACCESS_CONTROL_ERROR',
        message: error.message
      });
    }
  };
}

/**
 * Check if user has the required access level to a consultation
 * @param {string} consultationId - Consultation UUID
 * @param {string} userId - User UUID
 * @param {string} requiredLevel - Required level: 'read', 'write', 'admin'
 * @param {string} brandId - Brand UUID
 * @returns {Promise<boolean>} - True if user has required access
 */
export async function checkConsultationAccess(
  consultationId,
  userId,
  requiredLevel = 'read',
  brandId
) {
  if (!consultationId || !userId) {
    return false;
  }

  try {
    // Check if user is the owner (full access)
    const isOwner = await db.oneOrNone(
      `SELECT id FROM law_consultations
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [consultationId, userId, brandId]
    );

    if (isOwner) {
      return true; // Owner has full access
    }

    // Check explicit access grants
    const accessGrant = await db.oneOrNone(
      `SELECT access_level FROM law_consultation_access
       WHERE consultation_id = $1
         AND user_id = $2
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [consultationId, userId]
    );

    if (!accessGrant) {
      return false; // No explicit access
    }

    // Check if granted level is sufficient for required level
    return hasAccessLevel(accessGrant.access_level, requiredLevel);
  } catch (error) {
    console.error('Error checking consultation access:', error);
    return false;
  }
}

/**
 * Determine if grantedLevel satisfies requiredLevel
 * Access level hierarchy: admin > write > read
 * @param {string} grantedLevel - Access level granted to user
 * @param {string} requiredLevel - Required access level
 * @returns {boolean} - True if granted level is sufficient
 */
function hasAccessLevel(grantedLevel, requiredLevel) {
  const levels = { read: 1, write: 2, admin: 3 };
  return (levels[grantedLevel] || 0) >= (levels[requiredLevel] || 0);
}

/**
 * Grant access to a consultation for a user
 * @param {string} consultationId - Consultation UUID
 * @param {string} userId - User UUID to grant access to
 * @param {string} accessLevel - Access level to grant
 * @param {string} grantedBy - User UUID granting access (usually the owner)
 * @param {Object} options - Optional settings
 * @returns {Promise<Object>} - Created access grant record
 */
export async function grantConsultationAccess(
  consultationId,
  userId,
  accessLevel = 'read',
  grantedBy,
  options = {}
) {
  const { expiresIn } = options; // in days

  if (!['read', 'write', 'admin'].includes(accessLevel)) {
    throw new Error('Invalid accessLevel');
  }

  try {
    let expiresAt = null;
    if (expiresIn && expiresIn > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresIn);
    }

    const result = await db.one(
      `INSERT INTO law_consultation_access (
        consultation_id, user_id, access_level, granted_by, expires_at
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (consultation_id, user_id)
      DO UPDATE SET
        access_level = $3,
        granted_by = $4,
        granted_at = NOW(),
        revoked_at = NULL,
        expires_at = $5
      RETURNING id, consultation_id, user_id, access_level, granted_at, expires_at`,
      [consultationId, userId, accessLevel, grantedBy, expiresAt]
    );

    return result;
  } catch (error) {
    console.error('Error granting access:', error);
    throw error;
  }
}

/**
 * Revoke access to a consultation for a user
 * @param {string} consultationId - Consultation UUID
 * @param {string} userId - User UUID to revoke access from
 * @param {string} reason - Reason for revocation (for audit log)
 * @returns {Promise<Object>} - Updated access record
 */
export async function revokeConsultationAccess(consultationId, userId, reason = null) {
  try {
    const result = await db.one(
      `UPDATE law_consultation_access
       SET revoked_at = NOW()
       WHERE consultation_id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id, consultation_id, user_id, revoked_at`,
      [consultationId, userId]
    );

    return result;
  } catch (error) {
    console.error('Error revoking access:', error);
    throw error;
  }
}

/**
 * List all users with access to a consultation
 * @param {string} consultationId - Consultation UUID
 * @returns {Promise<Object[]>} - Access records with user details
 */
export async function listConsultationAccess(consultationId) {
  try {
    const records = await db.many(
      `SELECT
        cca.id,
        cca.user_id,
        cu.email,
        cu.full_name,
        cca.access_level,
        cca.granted_at,
        cca.expires_at,
        cca.revoked_at,
        (cu.id = (SELECT user_id FROM law_consultations WHERE id = $1)) as is_owner
       FROM law_consultation_access cca
       JOIN core_users cu ON cca.user_id = cu.id
       WHERE cca.consultation_id = $1
       ORDER BY cca.granted_at DESC`,
      [consultationId]
    );

    return records || [];
  } catch (error) {
    console.error('Error listing consultation access:', error);
    throw error;
  }
}

/**
 * Check if a user is the owner of a consultation
 * @param {string} consultationId - Consultation UUID
 * @param {string} userId - User UUID
 * @returns {Promise<boolean>} - True if user is the owner
 */
export async function isConsultationOwner(consultationId, userId) {
  try {
    const result = await db.oneOrNone(
      `SELECT id FROM law_consultations
       WHERE id = $1 AND user_id = $2`,
      [consultationId, userId]
    );

    return !!result;
  } catch (error) {
    console.error('Error checking consultation ownership:', error);
    return false;
  }
}

/**
 * Get all consultations a user can access (owned or explicitly granted)
 * @param {string} userId - User UUID
 * @param {string} brandId - Brand UUID
 * @param {Object} options - Filter options
 * @returns {Promise<Object[]>} - Consultations the user can access
 */
export async function getUserConsultations(userId, brandId, options = {}) {
  const { limit = 50, offset = 0 } = options;

  try {
    const consultations = await db.many(
      `SELECT DISTINCT
        lc.id,
        lc.jurisdiction,
        lc.case_type,
        lc.status,
        lc.is_privileged,
        lc.confidentiality_level,
        lc.created_at,
        lc.updated_at,
        (lc.user_id = $1) as is_owner,
        (SELECT access_level FROM law_consultation_access
         WHERE consultation_id = lc.id AND user_id = $1
         AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
        ) as access_level
       FROM law_consultations lc
       LEFT JOIN law_consultation_access lca ON lc.id = lca.consultation_id
       WHERE lc.brand_id = $2
         AND (lc.user_id = $1 OR (lca.user_id = $1 AND lca.revoked_at IS NULL
              AND (lca.expires_at IS NULL OR lca.expires_at > NOW())))
       ORDER BY lc.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, brandId, limit, offset]
    );

    return consultations || [];
  } catch (error) {
    console.error('Error retrieving user consultations:', error);
    throw error;
  }
}

export default {
  requireConsultationAccess,
  checkConsultationAccess,
  grantConsultationAccess,
  revokeConsultationAccess,
  listConsultationAccess,
  isConsultationOwner,
  getUserConsultations
};
