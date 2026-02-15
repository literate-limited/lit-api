/**
 * Database Configuration
 * PostgreSQL connection pool setup with pg-promise
 */

const pgPromise = require('pg-promise');
const env = require('./env');

// Initialize pg-promise
const pgp = pgPromise({
  // Database options
  schema: 'public',
  promiseLib: Promise,

  // Connection events
  connect(client) {
    // Called when a new connection is established
    if (env.isDevelopment()) {
      console.log('[DB] Connection established');
    }
  },

  disconnect(client) {
    // Called when a connection is closed
    if (env.isDevelopment()) {
      console.log('[DB] Connection closed');
    }
  },

  error(err, e) {
    // Handle global errors
    if (e.cn) {
      // Connection error
      console.error('[DB] Connection error:', err.message);
    } else if (e.query) {
      // Query error
      console.error('[DB] Query error:', err.message);
      console.error('[DB] Query:', e.query);
    } else {
      // Other error
      console.error('[DB] Error:', err.message);
    }
  }
});

// Database connection configuration
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'lit_mvp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: env.isProduction() ? { rejectUnauthorized: false } : false
};

// Alternative: Use DATABASE_URL if provided
const connectionString = env.DATABASE_URL;

// Connection pool options
const poolConfig = {
  min: env.DATABASE_POOL_MIN,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
};

// Create connection pool
const db = pgp(connectionString || config);

/**
 * Health check
 */
async function healthCheck() {
  try {
    const result = await db.one('SELECT NOW() as now');
    return {
      healthy: true,
      timestamp: result.now,
      message: 'Database connection healthy'
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      message: 'Database connection failed'
    };
  }
}

/**
 * Close database connections
 */
async function close() {
  try {
    await pgp.end();
    console.log('[DB] Connection pool closed');
  } catch (error) {
    console.error('[DB] Error closing connection pool:', error.message);
    throw error;
  }
}

/**
 * Get database stats
 */
function getStats() {
  return {
    idle: db.$pool.idle,
    size: db.$pool.size,
    available: db.$pool.available,
    total: db.$pool.size
  };
}

module.exports = {
  db,
  pgp,
  healthCheck,
  close,
  getStats,
  config: {
    connectionString,
    poolConfig,
    dbConfig: config
  }
};
