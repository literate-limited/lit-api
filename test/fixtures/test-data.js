/**
 * Test Data Fixtures
 * Reusable test data for integration tests
 */

/**
 * Valid test users
 */
const validUsers = {
  student: {
    email: 'student@example.com',
    password: 'SecurePass123!',
    firstName: 'John',
    lastName: 'Student',
    roles: ['student']
  },

  teacher: {
    email: 'teacher@example.com',
    password: 'SecurePass123!',
    firstName: 'Jane',
    lastName: 'Teacher',
    roles: ['teacher']
  },

  admin: {
    email: 'admin@example.com',
    password: 'SecurePass123!',
    firstName: 'Admin',
    lastName: 'User',
    roles: ['admin']
  },

  multiRole: {
    email: 'multirole@example.com',
    password: 'SecurePass123!',
    firstName: 'Multi',
    lastName: 'Role',
    roles: ['student', 'teacher', 'moderator']
  }
};

/**
 * Invalid test data
 */
const invalidData = {
  weakPasswords: [
    'short',
    'noupppercase123!',
    'NOLOWERCASE123!',
    'NoNumbers!',
    'NoSpecialChar123',
    '12345678'
  ],

  invalidEmails: [
    'not-an-email',
    '@example.com',
    'user@',
    'user name@example.com',
    'user@example',
    'user@@example.com'
  ],

  invalidUUIDs: [
    'not-a-uuid',
    '550e8400-e29b-41d4-a716',
    '550e8400-e29b-41d4-a716-446655440000-extra'
  ]
};

/**
 * Valid test credentials
 */
const validCredentials = {
  signup: {
    email: 'newuser@example.com',
    password: 'SecurePass123!',
    firstName: 'New',
    lastName: 'User'
  },

  login: {
    email: 'student@example.com',
    password: 'SecurePass123!'
  },

  wrongPassword: {
    email: 'student@example.com',
    password: 'WrongPassword123!'
  },

  nonexistentEmail: {
    email: 'nonexistent@example.com',
    password: 'SecurePass123!'
  }
};

/**
 * OAuth test data
 */
const oauthData = {
  google: {
    provider: 'google',
    providerId: 'google_12345',
    email: 'user@gmail.com',
    firstName: 'John',
    lastName: 'Google',
    avatarUrl: 'https://example.com/avatar.jpg'
  },

  github: {
    provider: 'github',
    providerId: 'github_67890',
    email: 'user@github.com',
    firstName: 'Jane',
    lastName: 'Github',
    avatarUrl: 'https://example.com/avatar.jpg'
  },

  microsoft: {
    provider: 'microsoft',
    providerId: 'microsoft_11111',
    email: 'user@microsoft.com',
    firstName: 'Mike',
    lastName: 'Microsoft',
    avatarUrl: 'https://example.com/avatar.jpg'
  }
};

/**
 * Role and permission test data
 */
const rbacData = {
  validRoles: ['admin', 'teacher', 'student', 'moderator'],

  validPermissions: [
    'manage_classes',
    'manage_users',
    'manage_content',
    'view_analytics',
    'edit_settings',
    'delete_account'
  ],

  rolePermissions: {
    admin: ['manage_classes', 'manage_users', 'manage_content', 'edit_settings', 'delete_account'],
    teacher: ['manage_classes', 'manage_content', 'view_analytics'],
    student: ['view_analytics'],
    moderator: ['manage_content']
  }
};

/**
 * User profile update test data
 */
const profileUpdates = {
  valid: {
    firstName: 'Johnny',
    lastName: 'Updated',
    displayLanguage: 'es',
    nativeLanguage: 'es',
    metadata: { custom_field: 'value' }
  },

  partial: {
    firstName: 'Johnny'
  },

  invalid: {
    firstName: 'A'.repeat(101), // Too long
    displayLanguage: 'invalid-language-code', // Invalid format
    unknown_field: 'value' // Should be stripped
  }
};

/**
 * Onboarding test data
 */
const onboardingData = {
  stages: ['needs', 'started', 'completed'],

  transitions: [
    { from: 'needs', to: 'started' },
    { from: 'needs', to: 'completed' },
    { from: 'started', to: 'completed' },
    { from: 'completed', to: 'needs' } // Allow reverting
  ]
};

/**
 * Pagination test data
 */
const paginationData = {
  validLimits: [1, 10, 20, 50, 100],

  validOffsets: [0, 10, 20, 50, 100],

  invalidLimits: [-1, 0, 101, 'abc'],

  invalidOffsets: [-1, 'abc']
};

/**
 * Brand test data
 */
const brandData = {
  validBrands: [
    { code: 'lit', name: 'Literate' },
    { code: 'ttv', name: 'TeleprompTV' },
    { code: 'mat', name: 'Math Madness' },
    { code: 'tp', name: 'True Phonetics' },
    { code: 'deb', name: 'Debatica' }
  ],

  invalidBrands: ['invalid', 'x' * 50, '123', 'BRAND']
};

/**
 * Error scenarios
 */
const errorScenarios = {
  missingRequiredFields: [
    { data: {}, field: 'email' },
    { data: { email: 'test@example.com' }, field: 'password' },
    { data: { email: 'test@example.com', password: 'SecurePass123!' }, field: 'targetBrandId' }
  ],

  malformedData: [
    { data: { email: null }, issue: 'null value' },
    { data: { email: 123 }, issue: 'wrong type' },
    { data: { metadata: 'not-an-object' }, issue: 'wrong type' }
  ]
};

/**
 * Response examples
 */
const responseExamples = {
  successSignup: {
    success: true,
    statusCode: 201,
    data: {
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        roles: ['student'],
        onboardingStage: 'needs'
      },
      accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      expiresIn: '7d'
    },
    meta: {
      timestamp: '2026-02-09T22:45:00.000Z',
      requestId: 'req_1707507900000_abc123def'
    }
  },

  errorValidation: {
    success: false,
    statusCode: 400,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [
        {
          field: 'email',
          message: 'Must be a valid email address',
          type: 'string.email'
        }
      ]
    },
    meta: {
      timestamp: '2026-02-09T22:45:00.000Z',
      requestId: 'req_1707507900000_abc123def'
    }
  },

  errorAuthentication: {
    success: false,
    statusCode: 401,
    error: {
      code: 'AUTHENTICATION_ERROR',
      message: 'Invalid email or password'
    },
    meta: {
      timestamp: '2026-02-09T22:45:00.000Z',
      requestId: 'req_1707507900000_abc123def'
    }
  },

  errorAuthorization: {
    success: false,
    statusCode: 403,
    error: {
      code: 'AUTHORIZATION_ERROR',
      message: 'Only administrators can manage users',
      details: ['insufficient_permission']
    },
    meta: {
      timestamp: '2026-02-09T22:45:00.000Z',
      requestId: 'req_1707507900000_abc123def'
    }
  }
};

module.exports = {
  validUsers,
  invalidData,
  validCredentials,
  oauthData,
  rbacData,
  profileUpdates,
  onboardingData,
  paginationData,
  brandData,
  errorScenarios,
  responseExamples
};
