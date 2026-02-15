/**
 * Brand Configuration
 * Defines all multi-tenant brands/apps
 */

const brands = {
  lit: {
    id: 'lit-brand-id', // Will be replaced with actual UUID from DB
    code: 'lit',
    name: 'LIT Lang',
    fullName: 'Language Immersion Technology',
    theme: 'lit',
    logo: '/lit-logo.svg',
    primaryColor: '#4F46E5',
    secondaryColor: '#10B981',
    accentColor: '#F59E0B',
    defaultLanguage: 'fr',
    features: ['classes', 'chat', 'curriculum', 'adaptive-learning'],
    allowedOrigins: [
      'http://localhost:5173',
      'https://playliterate.app',
      'https://www.playliterate.app'
    ],
    meta: {
      title: 'LIT Lang - Language Immersion Technology',
      description: 'AI-powered language learning through immersive conversation',
      ogImage: '/lit-og-image.png'
    }
  },

  ttv: {
    id: 'ttv-brand-id',
    code: 'ttv',
    name: 'TeleprompTV',
    fullName: 'TeleprompTV - AI Video Production',
    theme: 'ttv',
    logo: '/ttv-logo.svg',
    primaryColor: '#10B981',
    secondaryColor: '#3B82F6',
    accentColor: '#8B5CF6',
    defaultLanguage: 'en',
    features: ['teleprompt', 'video-editing', 'transcription', 'ai-enhancement'],
    allowedOrigins: [
      'http://localhost:1313',
      'https://teleprompttv.tv',
      'https://www.teleprompttv.tv'
    ],
    meta: {
      title: 'TeleprompTV - AI-Powered Video Production',
      description: 'Create professional videos with AI-assisted teleprompter and editing tools',
      ogImage: '/ttv-og-image.png'
    }
  },

  mat: {
    id: 'mat-brand-id',
    code: 'mat',
    name: 'Math Madness',
    fullName: 'Math Madness - Learn Math Through Games',
    theme: 'mat',
    logo: '/mat-logo.svg',
    primaryColor: '#EC4899',
    secondaryColor: '#06B6D4',
    accentColor: '#F59E0B',
    defaultLanguage: 'en',
    features: ['games', 'curriculum', 'scoring', 'achievements'],
    allowedOrigins: [
      'https://mathmadness.app',
      'https://www.mathmadness.app'
    ],
    meta: {
      title: 'Math Madness - Master Math with AI',
      description: 'Learn mathematics through engaging games and AI tutoring',
      ogImage: '/mat-og-image.png'
    }
  },

  tp: {
    id: 'tp-brand-id',
    code: 'tp',
    name: 'True Phonetics',
    fullName: 'True Phonetics - Master Pronunciation',
    theme: 'tp',
    logo: '/tp-logo.svg',
    primaryColor: '#0EA5E9',
    secondaryColor: '#8B5CF6',
    accentColor: '#F59E0B',
    defaultLanguage: 'en',
    features: ['games', 'curriculum', 'audio-feedback', 'pronunciation'],
    allowedOrigins: [
      'https://truephonetics.com',
      'https://www.truephonetics.com'
    ],
    meta: {
      title: 'True Phonetics - Perfect Your Pronunciation',
      description: 'Master phonetics and pronunciation with AI-powered feedback',
      ogImage: '/tp-og-image.png'
    }
  },

  deb: {
    id: 'deb-brand-id',
    code: 'deb',
    name: 'Debatica',
    fullName: 'Debatica - Master Debate & Rhetoric',
    theme: 'deb',
    logo: '/deb-logo.svg',
    primaryColor: '#6366F1',
    secondaryColor: '#EC4899',
    accentColor: '#F59E0B',
    defaultLanguage: 'en',
    features: ['games', 'curriculum', 'debate-analysis', 'rhetoric'],
    allowedOrigins: [
      'https://debatica.app',
      'https://www.debatica.app'
    ],
    meta: {
      title: 'Debatica - Master Debate & Critical Thinking',
      description: 'Develop debate skills and critical thinking through AI-guided practice',
      ogImage: '/deb-og-image.png'
    }
  }
};

/**
 * Get brand by code
 */
function getBrand(brandCode) {
  return brands[brandCode];
}

/**
 * Get all brands
 */
function getAllBrands() {
  return brands;
}

/**
 * Check if brand exists
 */
function brandExists(brandCode) {
  return !!brands[brandCode];
}

module.exports = {
  brands,
  getBrand,
  getAllBrands,
  brandExists
};
