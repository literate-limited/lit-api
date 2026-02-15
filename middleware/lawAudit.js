import db from '../db.js';

/**
 * Law Audit Logging Middleware
 *
 * Logs all actions on consultations for compliance and security
 * IMPORTANT: Logs metadata only - NO case content or sensitive data
 *
 * Usage in routes:
 * router.post('/consultations', auditLog('consultation_created', 'consultation'), ...)
 */

/**
 * Create audit logging middleware
 * @param {string} actionType - The action being performed
 * @param {string} resourceType - Type of resource (consultation, message, etc)
 * @returns {Function} - Express middleware
 */
export function auditLog(actionType, resourceType) {
  return async (req, res, next) => {
    // Store original res.json for later
    const originalJson = res.json;

    // Intercept the response to log after execution
    res.json = function(data) {
      // Log the action after the response is sent
      setImmediate(async () => {
        try {
          await logAuditEvent({
            brandId: req.brandId,
            userId: req.user?.userId || null,
            userEmail: req.user?.email || null,
            userRole: req.user?.role || null,
            userIpAddress: getClientIp(req),
            userAgent: req.get('user-agent'),
            actionType,
            resourceType,
            resourceId: data?.id || req.params?.id || null,
            actionMetadata: {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode,
              ...getActionMetadata(req, data)
            },
            actionResult: res.statusCode < 400 ? 'success' : 'failure',
            failureReason: res.statusCode >= 400 ? data?.error || 'HTTP ' + res.statusCode : null
          }).catch(err => {
            console.error('Failed to log audit event:', err);
          });
        } catch (error) {
          console.error('Audit logging error:', error);
        }
      });

      // Call original json method
      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Log access denial (when someone tries to access a consultation they don't have permission for)
 * @param {string} brandId - Brand UUID
 * @param {string} userId - User UUID
 * @param {string} resourceId - Consultation UUID
 * @param {Object} req - Express request object
 * @returns {Promise<void>}
 */
export async function logAccessDenial(brandId, userId, resourceId, req) {
  try {
    const user = req.user || {};
    await logAuditEvent({
      brandId,
      userId: userId || user.userId,
      userEmail: user.email,
      userRole: user.role,
      userIpAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
      actionType: 'access_denied',
      resourceType: 'consultation',
      resourceId,
      actionMetadata: {
        method: req.method,
        path: req.path,
        reason: 'Unauthorized access attempt'
      },
      actionResult: 'denied',
      failureReason: 'Access denied - insufficient permissions'
    });
  } catch (error) {
    console.error('Failed to log access denial:', error);
  }
}

/**
 * Log an audit event to the database
 * @param {Object} event - Audit event details
 * @returns {Promise<Object>} - Created audit log record
 */
async function logAuditEvent(event) {
  const {
    brandId,
    userId,
    userEmail,
    userRole,
    userIpAddress,
    userAgent,
    actionType,
    resourceType,
    resourceId,
    actionMetadata = {},
    actionResult,
    failureReason
  } = event;

  try {
    const result = await db.one(
      `INSERT INTO law_audit_log (
        brand_id, user_id, user_email, user_role,
        user_ip_address, user_agent,
        action_type, resource_type, resource_id,
        action_metadata, action_result, failure_reason
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      ) RETURNING id, created_at`,
      [
        brandId,
        userId,
        userEmail,
        userRole,
        userIpAddress,
        userAgent,
        actionType,
        resourceType,
        resourceId,
        JSON.stringify(actionMetadata),
        actionResult,
        failureReason
      ]
    );

    return result;
  } catch (error) {
    console.error('Error logging audit event:', error);
    throw error;
  }
}

/**
 * Extract metadata from request and response (NO sensitive data)
 * @param {Object} req - Express request
 * @param {Object} data - Response data
 * @returns {Object} - Metadata object
 */
function getActionMetadata(req, data) {
  const metadata = {};

  // Extract only non-sensitive metadata from request
  if (req.body) {
    // Log field names only, not values (to avoid leaking data)
    metadata.requestFields = Object.keys(req.body);
  }

  // From response, only log IDs and counts (no content)
  if (data) {
    if (data.id) metadata.createdId = data.id;
    if (data.total) metadata.total = data.total;
    if (data.count) metadata.count = data.count;
    if (data.message && typeof data.message === 'string') {
      metadata.resultMessage = data.message;
    }
  }

  return metadata;
}

/**
 * Extract client IP address from request
 * Handles X-Forwarded-For, X-Real-IP, and direct connection
 * @param {Object} req - Express request
 * @returns {string} - Client IP address
 */
function getClientIp(req) {
  const xForwardedFor = req.get('x-forwarded-for');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }

  return req.get('x-real-ip') || req.connection.remoteAddress || 'unknown';
}

/**
 * Retrieve audit logs (admin only)
 * @param {string} brandId - Brand UUID
 * @param {Object} filters - Filter options
 * @returns {Promise<Object[]>} - Audit log records
 */
export async function getAuditLogs(brandId, filters = {}) {
  const {
    userId,
    actionType,
    resourceType,
    resourceId,
    startDate,
    endDate,
    limit = 100,
    offset = 0
  } = filters;

  let query = 'SELECT * FROM law_audit_log WHERE brand_id = $1';
  const params = [brandId];
  let paramNum = 2;

  if (userId) {
    query += ` AND user_id = $${paramNum}`;
    params.push(userId);
    paramNum++;
  }

  if (actionType) {
    query += ` AND action_type = $${paramNum}`;
    params.push(actionType);
    paramNum++;
  }

  if (resourceType) {
    query += ` AND resource_type = $${paramNum}`;
    params.push(resourceType);
    paramNum++;
  }

  if (resourceId) {
    query += ` AND resource_id = $${paramNum}`;
    params.push(resourceId);
    paramNum++;
  }

  if (startDate) {
    query += ` AND created_at >= $${paramNum}`;
    params.push(new Date(startDate));
    paramNum++;
  }

  if (endDate) {
    query += ` AND created_at <= $${paramNum}`;
    params.push(new Date(endDate));
    paramNum++;
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramNum} OFFSET $${paramNum + 1}`;
  params.push(limit, offset);

  try {
    const logs = await db.many(query, params);
    return logs || [];
  } catch (error) {
    console.error('Error retrieving audit logs:', error);
    throw error;
  }
}

/**
 * Export audit logs for compliance/discovery
 * Returns a summary (no sensitive data) for legal review
 * @param {string} brandId - Brand UUID
 * @param {Object} filters - Filter options
 * @returns {Promise<Object[]>} - Audit log summaries
 */
export async function exportAuditLogs(brandId, filters = {}) {
  try {
    const logs = await getAuditLogs(brandId, { ...filters, limit: 10000 });

    // Return only non-sensitive fields
    return logs.map(log => ({
      timestamp: log.created_at,
      action: log.action_type,
      resource: `${log.resource_type}:${log.resource_id}`,
      user: log.user_email || 'unknown',
      result: log.action_result,
      ip: log.user_ip_address
    }));
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    throw error;
  }
}

export default {
  auditLog,
  logAccessDenial,
  logAuditEvent,
  getAuditLogs,
  exportAuditLogs
};
