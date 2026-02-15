/**
 * Server Entry Point
 * Initializes database, services, controllers, and starts HTTP server
 */

const env = require('./config/env');
const { createApp } = require('./app');

// Import initialization functions
const database = require('./config/database');
const { initializeServices } = require('./services');
const AuthController = require('./controllers/v2/auth.controller');
const UserController = require('./controllers/v2/user.controller');

// Import DALs
const CoreUserDAL = require('./dal/core_user.dal');
const UserDAL = require('./dal/user.dal');

/**
 * Start server
 */
async function startServer() {
  try {
    console.log('[SERVER] Starting server in', env.NODE_ENV, 'environment...');

    // 1. Initialize Database
    console.log('[DATABASE] Connecting to database...');
    const db = database.getInstance();

    // Test connection
    const isHealthy = await database.healthCheck();
    if (!isHealthy) {
      throw new Error('Database health check failed');
    }
    console.log('[DATABASE] Connected successfully');

    // 2. Initialize DALs
    console.log('[DAL] Initializing Data Access Layer...');
    const coreUserDAL = new CoreUserDAL(db);
    const userDAL = new UserDAL(db);

    const dals = {
      coreUserDAL,
      userDAL
    };

    // 3. Initialize Services
    console.log('[SERVICES] Initializing services...');
    const services = initializeServices(dals);

    // 4. Initialize Controllers
    console.log('[CONTROLLERS] Initializing controllers...');
    const controllers = {
      auth: new AuthController(services.auth, services.oauth),
      user: new UserController(services.user)
    };

    // 5. Create Express App
    console.log('[APP] Creating Express application...');
    const app = createApp(services, controllers);

    // 6. Start HTTP Server
    const PORT = env.PORT || 3000;
    const server = app.listen(PORT, () => {
      console.log(`[SERVER] ✅ Server running on http://localhost:${PORT}`);
      console.log(`[SERVER] API endpoint: http://localhost:${PORT}/api/v2`);
      console.log(`[SERVER] Health check: http://localhost:${PORT}/health`);
    });

    /**
     * Graceful Shutdown
     */
    const gracefulShutdown = async () => {
      console.log('\n[SERVER] Shutting down gracefully...');

      // Close HTTP server
      server.close(async () => {
        console.log('[SERVER] HTTP server closed');

        try {
          // Close database connections
          await database.close();
          console.log('[DATABASE] Disconnected');
          process.exit(0);
        } catch (err) {
          console.error('[ERROR] Error during shutdown:', err.message);
          process.exit(1);
        }
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        console.error('[SERVER] Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('[ERROR] Uncaught Exception:', err);
      gracefulShutdown();
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (err) => {
      console.error('[ERROR] Unhandled Rejection:', err);
      gracefulShutdown();
    });
  } catch (error) {
    console.error('[ERROR] Failed to start server:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Start server if this is the main module
if (require.main === module) {
  startServer();
}

module.exports = { startServer };
