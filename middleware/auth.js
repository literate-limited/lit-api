/**
 * Authentication Middleware
 * JWT token verification and user injection
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '30d';

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-change-in-production') {
  console.warn('⚠️  WARNING: Using default JWT_SECRET in production. Set JWT_SECRET environment variable!');
}

/**
 * Extract token from Authorization header
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    throw new Error('Invalid authorization header format. Expected: Bearer <token>');
  }

  return parts[1];
}

/**
 * Verify JWT token
 */
function verifyTokenHelper(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw new Error('Token verification failed');
  }
}

/**
 * Auth Middleware - Verifies JWT and injects user data
 *
 * Usage: app.use(authMiddleware) or router.use(authMiddleware)
 *
 * Sets on request:
 * - req.token: Raw JWT token
 * - req.user: Decoded JWT payload
 * - req.userId: Brand-specific user ID
 * - req.coreUserId: Global core user ID
 * - req.email: User email
 * - req.userRoles: User roles array
 */
export function authMiddleware(req, res, next) {
  try {
    // Extract token
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Authorization token required'
      });
    }

    // Verify token
    const decoded = verifyTokenHelper(token);

    // Validate required fields
    if (!decoded.userId || !decoded.coreUserId || !decoded.brandId) {
      return res.status(401).json({
        error: 'Invalid token payload',
        message: 'Token missing required fields'
      });
    }

    // Inject into request
    req.token = token;
    req.user = decoded;
    req.userId = decoded.userId;
    req.coreUserId = decoded.coreUserId;
    req.email = decoded.email;
    req.userRoles = decoded.roles || [];

    // Validate brand consistency
    if (req.brandId && req.user.brandId !== req.brandId) {
      return res.status(403).json({
        error: 'Brand mismatch',
        message: 'User token is not valid for this brand'
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Authentication error',
      message: error.message || 'Failed to verify token'
    });
  }
}

/**
 * Optional Auth Middleware
 * Like authMiddleware but doesn't throw if token missing
 * Sets req.user to null if no token
 */
export function optionalAuthMiddleware(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      req.user = null;
      req.userId = null;
      req.coreUserId = null;
      return next();
    }

    const decoded = verifyTokenHelper(token);

    req.token = token;
    req.user = decoded;
    req.userId = decoded.userId;
    req.coreUserId = decoded.coreUserId;
    req.email = decoded.email;
    req.userRoles = decoded.roles || [];

    next();
  } catch (error) {
    // Don't error on optional auth, just continue without user
    req.user = null;
    req.userId = null;
    req.coreUserId = null;
    next();
  }
}

/**
 * Generate JWT Token
 *
 * @param {Object} payload - Token payload
 * @param {string} payload.userId - Brand-specific user ID
 * @param {string} payload.coreUserId - Global core user ID
 * @param {string} payload.email - User email
 * @param {Array} payload.roles - User roles
 * @param {string} payload.brandId - Brand ID
 * @param {string} expiresIn - Token expiration (default: 7d)
 * @returns {string} JWT token
 */
export function generateToken(payload, expiresIn = JWT_EXPIRY) {
  const tokenPayload = {
    userId: payload.userId,
    coreUserId: payload.coreUserId,
    email: payload.email,
    roles: payload.roles || [],
    brandId: payload.brandId
  };

  return jwt.sign(tokenPayload, JWT_SECRET, { expiresIn });
}

/**
 * Generate Refresh Token
 *
 * @param {Object} payload - Token payload
 * @param {string} expiresIn - Token expiration (default: 30d)
 * @returns {string} Refresh token
 */
export function generateRefreshToken(payload, expiresIn = JWT_REFRESH_EXPIRY) {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn });
}

/**
 * Verify Refresh Token
 *
 * @param {string} token - Refresh token
 * @returns {Object} Decoded token
 */
export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
}

/**
 * Role-based authorization middleware
 * Must be used AFTER authMiddleware
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'You must be logged in to access this resource'
      });
    }

    if (!allowedRoles.includes(req.user.role) && !allowedRoles.some(role => (req.userRoles || []).includes(role))) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `This resource requires one of the following roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

/**
 * Optional authentication middleware (alias for compatibility)
 */
export function optionalAuth(req, res, next) {
  return optionalAuthMiddleware(req, res, next);
}

/**
 * Verify token middleware (alias for compatibility)
 */
export function verifyToken(req, res, next) {
  return authMiddleware(req, res, next);
}
