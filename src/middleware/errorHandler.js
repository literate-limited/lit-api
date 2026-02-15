/**
 * Global Error Handler Middleware
 * Catches all errors and returns standardized response
 */

const env = require('../config/env');
const { AppError } = require('../errors/AppError');

/**
 * Format error response
 */
function formatErrorResponse(error, requestId) {
  const isAppError = error instanceof AppError;

  const statusCode = isAppError ? error.statusCode : 500;
  const code = isAppError ? error.code : 'INTERNAL_ERROR';
  const message = isAppError ? error.message : 'Internal server error';
  const details = isAppError && error.details ? error.details : [];

  return {
    success: false,
    statusCode,
    error: {
      code,
      message,
      ...(details.length > 0 && { details })
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId
    }
  };
}

/**
 * Log error (in development only)
 */
function logError(error, requestId) {
  const timestamp = new Date().toISOString();
  const errorInfo = {
    timestamp,
    requestId,
    code: error.code || 'UNKNOWN',
    message: error.message,
    stack: error.stack
  };

  if (env.isDevelopment()) {
    console.error('[ERROR]', JSON.stringify(errorInfo, null, 2));
  } else {
    // In production, would send to logging service
    console.error(`[${timestamp}] ${error.code || 'ERROR'}: ${error.message}`);
  }
}

/**
 * Global Error Handler
 *
 * Usage: app.use(errorHandler) - MUST be last middleware
 *
 * Handles:
 * - AppError and subclasses (known errors)
 * - Unexpected errors
 * - Database errors
 * - Validation errors
 */
function errorHandler(err, req, res, next) {
  // Get request ID for tracking
  const requestId = req.id || req.headers['x-request-id'] || 'unknown';

  // Log error
  logError(err, requestId);

  // Already sent response
  if (res.headersSent) {
    return next(err);
  }

  // Determine status code and response
  let response;

  if (err instanceof AppError) {
    // Known application error
    response = formatErrorResponse(err, requestId);
  } else if (err.name === 'ValidationError' && err.joi) {
    // Joi validation error
    response = formatErrorResponse({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: err.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        type: detail.type
      }))
    }, requestId);
  } else if (err.code === '22P02') {
    // PostgreSQL: Invalid text representation of UUID
    response = formatErrorResponse({
      statusCode: 400,
      code: 'INVALID_UUID',
      message: 'Invalid ID format'
    }, requestId);
  } else if (err.code === '23505') {
    // PostgreSQL: Unique violation
    response = formatErrorResponse({
      statusCode: 409,
      code: 'UNIQUE_VIOLATION',
      message: 'This resource already exists'
    }, requestId);
  } else if (err.code === '23503') {
    // PostgreSQL: Foreign key violation
    response = formatErrorResponse({
      statusCode: 400,
      code: 'FOREIGN_KEY_VIOLATION',
      message: 'Invalid reference'
    }, requestId);
  } else if (err.code === '42P01') {
    // PostgreSQL: Table not found
    response = formatErrorResponse({
      statusCode: 500,
      code: 'DATABASE_ERROR',
      message: 'Database schema error'
    }, requestId);
  } else if (err.message && err.message.includes('ECONNREFUSED')) {
    // Database connection error
    response = formatErrorResponse({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database connection failed'
    }, requestId);
  } else {
    // Unknown error
    response = formatErrorResponse({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: env.isDevelopment() ? err.message : 'Internal server error'
    }, requestId);
  }

  // Set response status
  const statusCode = response.statusCode;

  // Return response
  res.status(statusCode).json(response);
}

/**
 * 404 Not Found Handler
 * Use before error handler to catch unmatched routes
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    statusCode: 404,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`
    },
    meta: {
      timestamp: new Date().toISOString()
    }
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
  formatErrorResponse,
  logError
};
