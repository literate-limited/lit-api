/**
 * Jest Setup File
 * Configures test environment and global utilities
 */

// Silence console logs during tests (uncomment to see logs)
// global.console.log = jest.fn();
// global.console.error = jest.fn();
// global.console.warn = jest.fn();

/**
 * Global test timeout
 */
jest.setTimeout(10000);

/**
 * Mock environment variables for testing
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.JWT_SECRET = 'test-secret-key';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';
process.env.JWT_EXPIRY = '7d';
process.env.JWT_REFRESH_EXPIRY = '30d';
process.env.DEFAULT_BRAND = 'lit';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/lit_mvp_test';
process.env.REDIS_URL = 'redis://localhost:6379/0';
process.env.NODE_ENV = 'test';

/**
 * Global test utilities
 */
global.testUtils = {
  /**
   * Generate valid test data
   */
  generateTestData: {
    user: () => ({
      email: `test_${Date.now()}@example.com`,
      password: 'SecurePass123!',
      firstName: 'Test',
      lastName: 'User'
    }),

    credentials: (email = `test_${Date.now()}@example.com`) => ({
      email,
      password: 'SecurePass123!'
    })
  },

  /**
   * Wait for async operation
   */
  wait: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Create mock request object
   */
  createMockRequest: (overrides = {}) => ({
    id: 'test-request-id',
    headers: {
      'x-request-id': 'test-request-id',
      'x-brand': 'lit'
    },
    brandCode: 'lit',
    brandId: 'brand-123',
    userId: 'user-123',
    coreUserId: 'core-user-123',
    user: {
      userId: 'user-123',
      coreUserId: 'core-user-123',
      email: 'test@example.com',
      roles: ['student'],
      brandId: 'brand-123'
    },
    ...overrides
  }),

  /**
   * Create mock response object
   */
  createMockResponse: () => {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      status: jest.fn(function (code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn(function (data) {
        this.body = data;
        return this;
      }),
      setHeader: jest.fn(function (key, value) {
        this.headers[key] = value;
        return this;
      }),
      getHeader: jest.fn(function (key) {
        return this.headers[key];
      })
    };
    return res;
  },

  /**
   * Assert standard response format
   */
  assertResponseFormat: (body) => {
    expect(body).toHaveProperty('success');
    expect(body).toHaveProperty('statusCode');
    expect(body).toHaveProperty('meta');
    expect(body.meta).toHaveProperty('timestamp');
    expect(body.meta).toHaveProperty('requestId');
  },

  /**
   * Assert error response format
   */
  assertErrorResponse: (body, expectedCode, expectedStatus) => {
    global.testUtils.assertResponseFormat(body);
    expect(body.success).toBe(false);
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    if (expectedCode) {
      expect(body.error.code).toBe(expectedCode);
    }
    if (expectedStatus) {
      expect(body.statusCode).toBe(expectedStatus);
    }
  }
};

/**
 * Custom matchers
 */
expect.extend({
  toBeValidUUID(received) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);

    return {
      pass,
      message: () =>
        `expected ${received} to be a valid UUID`
    };
  },

  toBeValidJWT(received) {
    const jwtRegex = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;
    const pass = jwtRegex.test(received);

    return {
      pass,
      message: () =>
        `expected ${received} to be a valid JWT token`
    };
  },

  toBeValidEmail(received) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const pass = emailRegex.test(received);

    return {
      pass,
      message: () =>
        `expected ${received} to be a valid email address`
    };
  }
});

/**
 * Make custom matchers available in all tests
 */
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toBeValidJWT(): R;
      toBeValidEmail(): R;
    }
  }
}
