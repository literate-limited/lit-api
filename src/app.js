/**
 * Express Application Setup
 * Configures middleware chain and routes
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const { brandResolverMiddleware } = require('./middleware/brandResolver');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { createAuthRoutes } = require('./routes/v2/auth.routes');
const { createUserRoutes } = require('./routes/v2/user.routes');

/**
 * Create and configure Express app
 * @param {Object} services - Initialized services (from initializeServices)
 * @param {Object} controllers - Initialized controllers
 * @returns {express.Application} Configured Express app
 */
function createApp(services, controllers) {
  const app = express();

  /**
   * Security Middleware
   */
  app.use(helmet());

  /**
   * CORS Middleware
   */
  const corsOptions = {
    origin: (origin, callback) => {
      // Allow requests without origin (e.g., mobile, desktop)
      if (!origin) return callback(null, true);

      // In production, check against allowed origins from brand config
      // For development, allow all
      if (env.isDevelopment()) {
        callback(null, true);
      } else {
        // Check if origin is in brand's allowedOrigins
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Brand', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 86400
  };
  app.use(cors(corsOptions));

  /**
   * Request Logging Middleware
   */
  if (env.isDevelopment()) {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined'));
  }

  /**
   * Body Parsing Middleware
   */
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  /**
   * Request ID Middleware
   */
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    res.setHeader('X-Request-ID', req.id);
    next();
  });

  /**
   * Health Check Endpoint
   */
  app.get('/health', (req, res) => {
    res.status(200).json({
      success: true,
      statusCode: 200,
      data: {
        status: 'healthy',
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString()
      }
    });
  });

  /**
   * Version Endpoint
   */
  app.get('/api/version', (req, res) => {
    res.status(200).json({
      success: true,
      statusCode: 200,
      data: {
        version: '2.0.0',
        api: 'v2',
        environment: env.NODE_ENV
      }
    });
  });

  /**
   * Middleware Chain
   * Order is critical!
   */

  // 1. Brand Resolution
  app.use(brandResolverMiddleware);

  /**
   * API Routes (v2)
   */

  // Auth routes (public and protected)
  app.use('/api/v2/auth', createAuthRoutes(controllers.auth));

  // User routes (all protected by authMiddleware)
  app.use('/api/v2/users', createUserRoutes(controllers.user));

  /**
   * Error Handling
   * Must be after all routes
   */

  // 404 Not Found
  app.use(notFoundHandler);

  // Global Error Handler (MUST be last)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
