/**
 * Brand Configuration
 *
 * This file defines the multi-tenant brand configuration for the platform.
 * Brands are identified by origin (domain) or explicit header.
 */

export const BRAND_CONFIG = {
  lit: {
    code: 'lit',
    name: 'LIT Lang',
    origins: [
      'http://localhost:5173',
      'https://lit-mvp.vercel.app',
      'https://playliterate.app',
      'https://www.playliterate.app',
      'https://litsuite.app',
      'https://www.litsuite.app',
      /^https:\/\/lit-mvp-.*\.vercel\.app$/
    ],
    theme: 'lit',
    defaultLanguage: 'fr'
  },
  ttv: {
    code: 'ttv',
    name: 'TeleprompTV',
    origins: [
      'http://localhost:1313',
      'https://teleprompttv.tv',
      'https://www.teleprompttv.tv',
      'https://teleprompttv.vercel.app',
      /^https:\/\/teleprompttv-.*\.vercel\.app$/
    ],
    theme: 'ttv',
    defaultLanguage: 'en'
  },
  law: {
    code: 'law',
    name: 'Lawlore',
    origins: [
      'http://localhost:7777',
      'https://lawlore.art',
      'https://www.lawlore.art',
      'https://law.litsuite.app',
      'https://www.law.litsuite.app',
      'https://lawlore.litsuite.app',
      /^https:\/\/lawlore-.*\.vercel\.app$/
    ],
    theme: 'law',
    defaultLanguage: 'en'
  },
  mat: {
    code: 'mat',
    name: 'Math Madness',
    origins: [
      'http://localhost:5174',
      'https://math.litsuite.app',
      'https://mathmadness.app',
      'https://www.mathmadness.app',
      /^https:\/\/mathmadness-.*\.vercel\.app$/
    ],
    theme: 'mat',
    defaultLanguage: 'en'
  },
  deb: {
    code: 'deb',
    name: 'Debatica',
    origins: [
      'http://localhost:5555',
      'https://debatica.art',
      'https://www.debatica.art',
      'https://deb.litsuite.app',
      /^https:\/\/debatica-.*\.vercel\.app$/
    ],
    theme: 'debatica',
    defaultLanguage: 'en'
  },
  signphony: {
    code: 'signphony',
    name: 'Signphony',
    origins: [
      'http://localhost:5175',
      'https://signphony.litsuite.app',
      'https://signsymposium.litsuite.app', // legacy domain (redirect)
      /^https:\/\/signphony-.*\.vercel\.app$/,
      /^https:\/\/signsymposium-.*\.vercel\.app$/ // legacy vercel previews
    ],
    theme: 'signphony',
    defaultLanguage: 'en'
  }
};

export const DEFAULT_BRAND = 'lit';

/**
 * Infer brand from origin (referrer or origin header)
 * @param {string} origin - The origin URL
 * @returns {string|null} - Brand code or null if not found
 */
export function inferBrandFromOrigin(origin) {
  if (!origin) return null;

  for (const [code, config] of Object.entries(BRAND_CONFIG)) {
    for (const allowedOrigin of config.origins) {
      if (typeof allowedOrigin === 'string') {
        // Exact match
        if (origin === allowedOrigin || origin.startsWith(allowedOrigin)) {
          return code;
        }
      } else if (allowedOrigin instanceof RegExp) {
        // Regex match
        if (allowedOrigin.test(origin)) {
          return code;
        }
      }
    }
  }

  return null;
}

/**
 * Get all allowed origins for CORS configuration
 * @returns {string[]} - Array of all allowed origins (excluding regex patterns)
 */
export function getAllAllowedOrigins() {
  const origins = [];

  for (const config of Object.values(BRAND_CONFIG)) {
    for (const origin of config.origins) {
      if (typeof origin === 'string') {
        origins.push(origin);
      }
    }
  }

  return origins;
}

/**
 * Check if an origin matches any brand's origin patterns
 * @param {string} origin - The origin to check
 * @returns {boolean}
 */
export function isAllowedOrigin(origin) {
  return inferBrandFromOrigin(origin) !== null;
}
