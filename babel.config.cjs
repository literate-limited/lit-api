/**
 * Babel Configuration for Jest
 * Enables ES module support in tests
 */

module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }]
  ]
};
