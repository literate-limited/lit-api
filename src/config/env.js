/**
 * Environment Configuration
 * Centralized environment variable management
 */

const getEnvVar = (key, defaultValue = undefined) => {
  const value = process.env[key];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue;
};

module.exports = {
  // Application
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3001', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Database
  DATABASE_URL: getEnvVar('DATABASE_URL', 'postgresql://localhost/lit_mvp'),
  DATABASE_POOL_MIN: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
  DATABASE_POOL_MAX: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Authentication
  JWT_SECRET: getEnvVar('JWT_SECRET', 'dev-secret-change-in-production'),
  JWT_EXPIRY: process.env.JWT_EXPIRY || '7d',
  JWT_REFRESH_SECRET: getEnvVar('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || '30d',

  // OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
  APPLE_CLIENT_SECRET: process.env.APPLE_CLIENT_SECRET,

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,

  // Email
  EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@literate.app',
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,

  // Brands
  DEFAULT_BRAND: process.env.DEFAULT_BRAND || 'lit',

  // API
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3001',
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL || 'http://localhost:5173',

  // Features
  ENABLE_OAUTH: process.env.ENABLE_OAUTH !== 'false',
  ENABLE_PAYMENTS: process.env.ENABLE_PAYMENTS !== 'false',
  ENABLE_REALTIME: process.env.ENABLE_REALTIME !== 'false',

  // Utilities
  isDevelopment: () => process.env.NODE_ENV === 'development',
  isProduction: () => process.env.NODE_ENV === 'production',
  isTest: () => process.env.NODE_ENV === 'test'
};
