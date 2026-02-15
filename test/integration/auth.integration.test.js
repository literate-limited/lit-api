/**
 * Auth Integration Tests
 * Tests complete auth flows with real database
 */

const request = require('supertest');
const { createApp } = require('../../src/app');
const { initializeServices } = require('../../src/services');
const database = require('../../src/config/database');

// Mock services and database for testing
jest.mock('../../src/config/database');

describe('Auth Integration Tests', () => {
  let app;
  let db;
  let services;

  beforeAll(async () => {
    // Initialize test database
    db = database.getInstance();

    // Initialize services with test DALs
    const DALs = {
      coreUserDAL: jest.fn(),
      userDAL: jest.fn()
    };

    services = initializeServices(DALs);

    // Create app with mock controllers
    const mockControllers = {
      auth: jest.fn(),
      user: jest.fn()
    };

    app = createApp(services, mockControllers);
  });

  afterAll(async () => {
    await database.close();
  });

  describe('Signup Flow', () => {
    it('should register new user with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v2/auth/signup')
        .set('X-Brand', 'lit')
        .send({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data.user).toHaveProperty('id');
      expect(res.body.data.user.email).toBe('newuser@example.com');
    });

    it('should reject weak password', async () => {
      const res = await request(app)
        .post('/api/v2/auth/signup')
        .set('X-Brand', 'lit')
        .send({
          email: 'user@example.com',
          password: 'weak',
          firstName: 'John',
          lastName: 'Doe'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/api/v2/auth/signup')
        .set('X-Brand', 'lit')
        .send({
          email: 'not-an-email',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject duplicate email', async () => {
      // Register first user
      await request(app)
        .post('/api/v2/auth/signup')
        .set('X-Brand', 'lit')
        .send({
          email: 'duplicate@example.com',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe'
        });

      // Try to register with same email
      const res = await request(app)
        .post('/api/v2/auth/signup')
        .set('X-Brand', 'lit')
        .send({
          email: 'duplicate@example.com',
          password: 'SecurePass123!',
          firstName: 'Jane',
          lastName: 'Smith'
        });

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_EXISTS');
    });
  });

  describe('Login Flow', () => {
    beforeEach(async () => {
      // Create test user
      await request(app)
        .post('/api/v2/auth/signup')
        .set('X-Brand', 'lit')
        .send({
          email: 'logintest@example.com',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe'
        });
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v2/auth/login')
        .set('X-Brand', 'lit')
        .send({
          email: 'logintest@example.com',
          password: 'SecurePass123!'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
    });

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/api/v2/auth/login')
        .set('X-Brand', 'lit')
        .send({
          email: 'nonexistent@example.com',
          password: 'SecurePass123!'
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/api/v2/auth/login')
        .set('X-Brand', 'lit')
        .send({
          email: 'logintest@example.com',
          password: 'WrongPassword123!'
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  describe('Token Refresh', () => {
    let refreshToken;

    beforeEach(async () => {
      const signupRes = await request(app)
        .post('/api/v2/auth/signup')
        .set('X-Brand', 'lit')
        .send({
          email: 'tokentest@example.com',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe'
        });

      refreshToken = signupRes.body.data.refreshToken;
    });

    it('should refresh access token with valid refresh token', async () => {
      const res = await request(app)
        .post('/api/v2/auth/refresh')
        .set('X-Brand', 'lit')
        .send({
          refreshToken
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
    });

    it('should reject invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/v2/auth/refresh')
        .set('X-Brand', 'lit')
        .send({
          refreshToken: 'invalid.token.here'
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  describe('Protected Endpoints', () => {
    let accessToken;

    beforeEach(async () => {
      const signupRes = await request(app)
        .post('/api/v2/auth/signup')
        .set('X-Brand', 'lit')
        .send({
          email: 'protectedtest@example.com',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe'
        });

      accessToken = signupRes.body.data.accessToken;
    });

    it('should logout with valid token', async () => {
      const res = await request(app)
        .post('/api/v2/auth/logout')
        .set('X-Brand', 'lit')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject logout without token', async () => {
      const res = await request(app)
        .post('/api/v2/auth/logout')
        .set('X-Brand', 'lit');

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should reject logout with invalid token', async () => {
      const res = await request(app)
        .post('/api/v2/auth/logout')
        .set('X-Brand', 'lit')
        .set('Authorization', 'Bearer invalid.token.here');

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  describe('Error Response Format', () => {
    it('should return standardized error response', async () => {
      const res = await request(app)
        .post('/api/v2/auth/login')
        .set('X-Brand', 'lit')
        .send({
          email: 'invalid-email',
          password: ''
        });

      expect(res.body).toHaveProperty('success');
      expect(res.body).toHaveProperty('statusCode');
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body.error).toHaveProperty('message');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('timestamp');
      expect(res.body.meta).toHaveProperty('requestId');
    });
  });
});
