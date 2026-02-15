/**
 * Brand Resolver Middleware
 * Detects and validates brand/tenant from request
 */

import { BRAND_CONFIG, DEFAULT_BRAND, inferBrandFromOrigin } from '../config/brands.config.js';
import db from '../db.js';

// Cache for brand lookups
const brandCache = new Map();

/**
 * Resolve brand from request
 *
 * Priority:
 * 1. x-brand header (explicit)
 * 2. Origin/Referer header (domain-based inference)
 * 3. Default brand (config)
 */
function resolveBrandCode(req) {
  // Priority 1: x-brand header
  const headerBrand = req.headers['x-brand'];
  if (headerBrand && BRAND_CONFIG[headerBrand]) {
    return headerBrand;
  }

  // Priority 2: Infer from origin/referer
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    const brandCode = inferBrandFromOrigin(origin);
    if (brandCode) {
      return brandCode;
    }
  }

  // Priority 3: Default brand
  return DEFAULT_BRAND;
}

/**
 * Get brand ID from database (with caching)
 * @param {string} brandCode - Brand code (e.g., 'lit', 'ttv')
 * @returns {Promise<string|null>} - Brand UUID or null
 */
async function getBrandId(brandCode) {
  if (brandCache.has(brandCode)) {
    return brandCache.get(brandCode);
  }

  const brand = await db.one(
    'SELECT id FROM brands WHERE code = $1',
    [brandCode]
  );

  if (brand) {
    brandCache.set(brandCode, brand.id);
    return brand.id;
  }

  return null;
}

/**
 * Validate brand origin
 * Ensures the request origin is allowed for this brand
 */
function validateOrigin(req, brandConfig) {
  const origin = req.headers.origin;

  if (!origin) {
    // No origin header (e.g., direct API call) - allow
    return true;
  }

  if (!brandConfig.allowedOrigins || brandConfig.allowedOrigins.length === 0) {
    // Brand allows all origins
    return true;
  }

  // Check if origin is in allowed list
  const isAllowed = brandConfig.allowedOrigins.some(allowedOrigin => {
    try {
      const requestUrl = new URL(origin);
      const allowedUrl = new URL(allowedOrigin);
      return requestUrl.hostname === allowedUrl.hostname;
    } catch (error) {
      return false;
    }
  });

  return isAllowed;
}

/**
 * Brand Resolver Middleware
 *
 * Sets on request:
 * - req.brandCode: Brand code (e.g., 'lit', 'ttv')
 * - req.brandId: Brand ID (UUID from database)
 * - req.brandMeta: Brand configuration
 */
export async function brandResolver(req, res, next) {
  try {
    // Resolve brand code
    const brandCode = resolveBrandCode(req);

    // Validate brand exists
    if (!BRAND_CONFIG[brandCode]) {
      return res.status(400).json({
        error: 'Invalid brand',
        message: `Brand '${brandCode}' not found`
      });
    }

    // Get brand ID from database
    const brandId = await getBrandId(brandCode);

    if (!brandId) {
      return res.status(500).json({
        error: 'Brand configuration error',
        message: `Brand '${brandCode}' not found in database`
      });
    }

    // Validate origin
    const brandConfig = BRAND_CONFIG[brandCode];
    const isOriginValid = validateOrigin(req, brandConfig);

    if (!isOriginValid) {
      return res.status(403).json({
        error: 'Origin not allowed',
        message: 'Request origin is not allowed for this brand'
      });
    }

    // Attach brand info to request
    req.brandCode = brandCode;
    req.brandId = brandId;
    req.brandMeta = brandConfig;

    // Optional: Log brand detection for debugging
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Brand] Resolved: ${brandCode} (${brandId})`);
    }

    next();
  } catch (error) {
    console.error('Brand resolver error:', error);
    return res.status(500).json({
      error: 'Failed to resolve brand',
      message: error.message
    });
  }
}

/**
 * Brand Validation Guard
 * Ensures user's token brand matches request brand
 *
 * Usage: router.use(authMiddleware, brandValidationGuard)
 */
export function brandValidationGuard(req, res, next) {
  if (!req.user || !req.brandId) {
    return next();
  }

  // Verify token brand matches request brand
  if (req.user.brandId !== req.brandId) {
    return res.status(403).json({
      error: 'Brand mismatch',
      message: 'User token is not valid for this brand'
    });
  }

  next();
}

/**
 * Clear brand cache (for testing or configuration updates)
 */
export function clearBrandCache() {
  brandCache.clear();
}

/**
 * Get brand cache stats
 */
export function getBrandCacheStats() {
  return {
    cacheSize: brandCache.size,
    cachedBrands: Array.from(brandCache.keys())
  };
}
