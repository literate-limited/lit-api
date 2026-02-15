/**
 * Service Layer Initialization
 * Central place to initialize and inject all services
 */

const AuthService = require('./auth/auth.service');
const OAuthService = require('./auth/oauth.service');
const UserService = require('./user/user.service');

/**
 * Initialize all services with DAL dependencies
 * @param {Object} dals - Data Access Layer instances
 * @returns {Object} All service instances
 */
function initializeServices(dals) {
  const { coreUserDAL, userDAL } = dals;

  if (!coreUserDAL || !userDAL) {
    throw new Error('Required DALs not provided: coreUserDAL, userDAL');
  }

  const authService = new AuthService(coreUserDAL, userDAL);
  const oauthService = new OAuthService(coreUserDAL, userDAL);
  const userService = new UserService(userDAL, coreUserDAL);

  return {
    auth: authService,
    oauth: oauthService,
    user: userService
  };
}

module.exports = {
  initializeServices,
  AuthService,
  OAuthService,
  UserService
};
