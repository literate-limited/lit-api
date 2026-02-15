/**
 * Request Validation Middleware
 * Validates request data using Joi schemas
 */

const Joi = require('joi');
const { ValidationError } = require('../errors/AppError');

/**
 * Validation middleware factory
 * Creates middleware that validates request data against a schema
 *
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @param {string} source - What to validate: 'body', 'params', 'query', 'all'
 * @returns {Function} Express middleware
 */
function validateRequest(schema, source = 'body') {
  return (req, res, next) => {
    try {
      let dataToValidate = {};

      if (source === 'body' || source === 'all') {
        dataToValidate = { ...dataToValidate, ...req.body };
      }
      if (source === 'params' || source === 'all') {
        dataToValidate = { ...dataToValidate, ...req.params };
      }
      if (source === 'query' || source === 'all') {
        dataToValidate = { ...dataToValidate, ...req.query };
      }

      const { error, value } = schema.validate(dataToValidate, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const details = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type
        }));

        throw new ValidationError('Request validation failed', details);
      }

      // Replace request data with validated data
      if (source === 'body' || source === 'all') {
        req.body = { ...req.body, ...value };
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Auth Validation Schemas
 */
const authSchemas = {
  signup: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({ 'string.email': 'Must be a valid email address' }),
    password: Joi.string()
      .min(8)
      .required()
      .messages({ 'string.min': 'Password must be at least 8 characters' }),
    firstName: Joi.string().max(100).optional(),
    lastName: Joi.string().max(100).optional()
  }),

  login: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({ 'string.email': 'Must be a valid email address' }),
    password: Joi.string()
      .required()
      .messages({ 'any.required': 'Password is required' })
  }),

  refresh: Joi.object({
    refreshToken: Joi.string()
      .required()
      .messages({ 'any.required': 'Refresh token is required' })
  }),

  requestPasswordReset: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({ 'string.email': 'Must be a valid email address' })
  }),

  resetPassword: Joi.object({
    token: Joi.string()
      .required()
      .messages({ 'any.required': 'Reset token is required' }),
    newPassword: Joi.string()
      .min(8)
      .required()
      .messages({ 'string.min': 'Password must be at least 8 characters' })
  }),

  verifyEmailToken: Joi.object({
    token: Joi.string()
      .required()
      .messages({ 'any.required': 'Verification token is required' })
  }),

  oauthCallback: Joi.object({
    provider: Joi.string()
      .valid('google', 'github', 'microsoft', 'facebook')
      .required()
      .messages({ 'any.only': 'Invalid provider' }),
    code: Joi.string()
      .required()
      .messages({ 'any.required': 'Authorization code is required' }),
    state: Joi.string().optional()
  }),

  linkProvider: Joi.object({
    provider: Joi.string()
      .valid('google', 'github', 'microsoft', 'facebook')
      .required()
      .messages({ 'any.only': 'Invalid provider' }),
    code: Joi.string()
      .required()
      .messages({ 'any.required': 'Authorization code is required' })
  }),

  unlinkProvider: Joi.object({
    provider: Joi.string()
      .valid('google', 'github', 'microsoft', 'facebook')
      .required()
      .messages({ 'any.only': 'Invalid provider' })
  }),

  ssoLogin: Joi.object({
    targetBrandId: Joi.string()
      .uuid()
      .required()
      .messages({ 'string.guid': 'Must be a valid UUID' })
  })
};

/**
 * User Validation Schemas
 */
const userSchemas = {
  updateProfile: Joi.object({
    firstName: Joi.string().max(100).optional(),
    lastName: Joi.string().max(100).optional(),
    displayLanguage: Joi.string().length(2).optional(),
    nativeLanguage: Joi.string().length(2).optional(),
    metadata: Joi.object().optional()
  }),

  updateOnboarding: Joi.object({
    stage: Joi.string()
      .valid('needs', 'started', 'completed')
      .required()
      .messages({ 'any.only': 'Must be needs, started, or completed' })
  }),

  addRole: Joi.object({
    role: Joi.string()
      .valid('admin', 'teacher', 'student', 'moderator')
      .required()
      .messages({ 'any.only': 'Invalid role' })
  }),

  removeRole: Joi.object({
    role: Joi.string()
      .valid('admin', 'teacher', 'student', 'moderator')
      .required()
      .messages({ 'any.only': 'Invalid role' })
  }),

  addPermission: Joi.object({
    permission: Joi.string()
      .required()
      .messages({ 'any.required': 'Permission is required' })
  }),

  removePermission: Joi.object({
    permission: Joi.string()
      .required()
      .messages({ 'any.required': 'Permission is required' })
  }),

  searchByRole: Joi.object({
    role: Joi.string()
      .required()
      .messages({ 'any.required': 'Role query parameter is required' }),
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .optional()
      .default(20),
    offset: Joi.number()
      .integer()
      .min(0)
      .optional()
      .default(0)
  }),

  userId: Joi.object({
    userId: Joi.string()
      .uuid()
      .required()
      .messages({ 'string.guid': 'Must be a valid UUID' })
  })
};

/**
 * Common Schemas
 */
const commonSchemas = {
  uuid: Joi.object({
    id: Joi.string()
      .uuid()
      .required()
      .messages({ 'string.guid': 'Must be a valid UUID' })
  }),

  pagination: Joi.object({
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .optional()
      .default(20),
    offset: Joi.number()
      .integer()
      .min(0)
      .optional()
      .default(0)
  })
};

module.exports = {
  validateRequest,
  authSchemas,
  userSchemas,
  commonSchemas
};
