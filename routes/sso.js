/**
 * Seamless SSO Routes
 * 
 * Flow:
 * 1. User enters credentials on any brand login page
 * 2. Brand POSTs to /api/auth/login (normal login)
 * 3. Brand also calls /api/sso/initiate in background to create SSO session
 * 4. User is now logged into brand + has SSO cookie on .litsuite.app
 * 5. User visits another brand -> auto-redirected through litsuite.app -> back
 *    (happens so fast they don't notice)
 */

import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import db from '../db.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { getAllAllowedOrigins } from '../config/brands.config.js';

const router = Router();

// LIT Suite SSO domain
const LITSUITE_DOMAIN = process.env.LITSUITE_DOMAIN || 'https://litsuite.app';
const SESSION_COOKIE_NAME = 'sso_session';
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

function getCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  // Minimal cookie parsing (avoid adding cookie-parser dep).
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function shouldSetLitsuiteDomainCookie(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  return host === 'litsuite.app' || host.endsWith('.litsuite.app');
}

function isSecureRequest(req) {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return xfProto === 'https' || Boolean(req.secure);
}

function setSsoSessionCookie(res, req, token) {
  const parts = [];
  parts.push(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
  parts.push('Path=/');
  parts.push(`Max-Age=${SESSION_MAX_AGE_SEC}`);
  parts.push('HttpOnly');
  // Cross-site cookie (brands are on different domains).
  parts.push('SameSite=None');
  if (isSecureRequest(req)) {
    parts.push('Secure');
  }
  // Only set Domain when we are on the litsuite.app domain tree.
  if (shouldSetLitsuiteDomainCookie(req)) {
    parts.push('Domain=.litsuite.app');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSsoSessionCookie(res, req) {
  const parts = [];
  parts.push(`${SESSION_COOKIE_NAME}=`);
  parts.push('Path=/');
  parts.push('Max-Age=0');
  if (shouldSetLitsuiteDomainCookie(req)) {
    parts.push('Domain=.litsuite.app');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function normalizeRedirectUri(uri) {
  try {
    const u = new URL(uri);
    // Allowlist matches on origin + pathname, ignore query/hash.
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

function isAllowedRedirectUri(redirectUri, allowedList) {
  const normalized = normalizeRedirectUri(redirectUri);
  if (!normalized) return false;

  const list = Array.isArray(allowedList) ? allowedList : [];
  for (const entry of list) {
    if (!entry) continue;
    const e = String(entry);
    // Backward compat: allow exact match (including query) if it was stored that way.
    if (redirectUri === e) return true;
    if (e.includes('*')) {
      // Very small wildcard support: '*' matches any substring.
      const re = new RegExp(
        '^' +
          e
            .split('*')
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*') +
          '$'
      );
      if (re.test(redirectUri) || re.test(normalized)) return true;
    } else if (normalized === e) {
      return true;
    }
  }
  return false;
}

async function getSsoClient(clientId) {
  let client = await db.one('SELECT * FROM sso_clients WHERE id = $1 AND active = true', [clientId]);
  if (client) {
    // Keep the default web client in sync with the configured brand origins/redirect URIs.
    // This prevents "invalid_redirect_uri" when new brands/domains are added after initial seeding.
    if (clientId === 'lit_web_client') {
      const origins = getAllAllowedOrigins();
      const redirectUris = Array.from(
        new Set(
          origins.flatMap((o) => [`${o}/auth/callback`, `${o}/auth/sso/callback`])
        )
      );

      const currentRedirects = Array.isArray(client.redirect_uris) ? client.redirect_uris : [];
      const currentOrigins = Array.isArray(client.allowed_origins) ? client.allowed_origins : [];

      const mergedRedirects = Array.from(new Set([...currentRedirects, ...redirectUris]));
      const mergedOrigins = Array.from(new Set([...currentOrigins, ...origins]));

      const changed =
        mergedRedirects.length !== currentRedirects.length ||
        mergedOrigins.length !== currentOrigins.length;

      if (changed) {
        await db.query(
          `UPDATE sso_clients
           SET redirect_uris = $2::jsonb, allowed_origins = $3::jsonb
           WHERE id = $1`,
          ['lit_web_client', JSON.stringify(mergedRedirects), JSON.stringify(mergedOrigins)]
        );
        client = await db.one('SELECT * FROM sso_clients WHERE id = $1 AND active = true', [clientId]);
      }
    }
    return client;
  }

  // Bootstrap a sane default client in fresh databases.
  if (clientId === 'lit_web_client') {
    const litBrandId = await getLitBrandId();
    if (!litBrandId) return null;

    const origins = getAllAllowedOrigins();
    const redirectUris = Array.from(
      new Set(
        origins.flatMap((o) => [`${o}/auth/callback`, `${o}/auth/sso/callback`])
      )
    );

    await db.query(
      `INSERT INTO sso_clients (id, brand_id, name, description, redirect_uris, allowed_origins, require_pkce, active)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, true, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        'lit_web_client',
        litBrandId,
        'LitSuite Web (multi-brand)',
        'Public web client used across LitSuite brands',
        JSON.stringify(redirectUris),
        JSON.stringify(origins),
      ]
    );

    client = await db.one('SELECT * FROM sso_clients WHERE id = $1 AND active = true', [clientId]);
    return client;
  }

  return null;
}

async function resolveBrandId(brandIdOrCode) {
  if (!brandIdOrCode) return null;
  const raw = String(brandIdOrCode).trim();
  if (!raw) return null;
  // Try UUID first.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  const row = await db.one('SELECT id FROM brands WHERE code = $1', [raw.toLowerCase()]);
  return row?.id || null;
}

let cachedLitBrandId = null;
async function getLitBrandId() {
  if (cachedLitBrandId) return cachedLitBrandId;
  const row = await db.one("SELECT id FROM brands WHERE code = 'lit'");
  cachedLitBrandId = row?.id || null;
  return cachedLitBrandId;
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

/**
 * Generate cryptographically secure random string
 */
function generateRandomString(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Hash code challenge from verifier (S256)
 */
function generateCodeChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

async function issueAuthCode({
  clientId,
  brandId,
  coreUserId,
  codeChallenge,
  codeChallengeMethod,
  redirectUri,
  scope,
  state,
}) {
  const authCode = generateRandomString(32);
  await db.query(
    `INSERT INTO sso_auth_codes
     (code, client_id, brand_id, core_user_id, code_challenge, code_challenge_method,
      redirect_uri, scope, state, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + INTERVAL '60 seconds')`,
    [
      authCode,
      clientId,
      brandId,
      coreUserId,
      codeChallenge,
      codeChallengeMethod || 'S256',
      redirectUri,
      scope || 'openid profile email',
      state || null,
    ]
  );
  return authCode;
}

/**
 * POST /api/sso/login
 * Centralized login endpoint for branded apps.
 *
 * Returns: { redirect_url }
 * Also sets the global SSO cookie on `.litsuite.app` (when hosted on a litsuite.app subdomain).
 */
router.post('/login', brandResolver, async (req, res) => {
  try {
    const {
      email,
      password,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod = 'S256',
      state,
      scope,
      brand_id: brandHint,
    } = req.body || {};

    if (!email || !password || !clientId || !redirectUri || !codeChallenge || !state) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters',
      });
    }

    const client = await getSsoClient(clientId);
    if (!client) return res.status(400).json({ error: 'invalid_client' });
    if (!isAllowedRedirectUri(redirectUri, client.redirect_uris)) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }

    const litBrandId = await getLitBrandId();
    if (!litBrandId) return res.status(500).json({ error: 'server_error' });

    const emailLower = String(email).toLowerCase().trim();

    // Prefer the canonical "core" account (lit brand) for a stable core_user_id.
    let coreUser = await db.one(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND brand_id = $2',
      [emailLower, litBrandId]
    );

    if (!coreUser) {
      // Fallback: find any brand account with this email, then clone into lit brand.
      const anyUser = await db.one(
        'SELECT * FROM users WHERE LOWER(email) = LOWER($1) ORDER BY created_at ASC LIMIT 1',
        [emailLower]
      );
      if (!anyUser?.password_hash) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      const valid = await bcrypt.compare(password, anyUser.password_hash);
      if (!valid) return res.status(401).json({ error: 'invalid_credentials' });

      const newCoreUserId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, first_name, last_name, role, brand_id, password_hash, credits)
         VALUES ($1, $2, $3, $4, 'student', $5, $6, COALESCE($7, 100))
         ON CONFLICT DO NOTHING`,
        [
          newCoreUserId,
          anyUser.email,
          anyUser.first_name || '',
          anyUser.last_name || '',
          litBrandId,
          anyUser.password_hash,
          anyUser.credits ?? 100,
        ]
      );
      coreUser = await db.one('SELECT * FROM users WHERE id = $1', [newCoreUserId]);
    } else {
      if (!coreUser.password_hash) return res.status(401).json({ error: 'invalid_credentials' });
      const valid = await bcrypt.compare(password, coreUser.password_hash);
      if (!valid) return res.status(401).json({ error: 'invalid_credentials' });
    }

    const targetBrandId = (await resolveBrandId(brandHint)) || req.brandId || client.brand_id;
    if (!targetBrandId) return res.status(400).json({ error: 'invalid_brand' });

    // Create or refresh SSO session (hash stored in DB, plaintext in cookie).
    const sessionToken = generateRandomString(32);
    const sessionHash = await bcrypt.hash(sessionToken, 10);
    await db.query(
      `INSERT INTO sso_sessions (session_token, core_user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4)
       ON CONFLICT (core_user_id) DO UPDATE SET
         session_token = EXCLUDED.session_token,
         expires_at = EXCLUDED.expires_at,
         last_used_at = NOW()`,
      [sessionHash, coreUser.id, req.ip, req.headers['user-agent']]
    );

    setSsoSessionCookie(res, req, sessionToken);

    const authCode = await issueAuthCode({
      clientId,
      brandId: targetBrandId,
      coreUserId: coreUser.id,
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      scope,
      state,
    });

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    redirectUrl.searchParams.set('state', state);

    // For browser-based flows (form POST), redirect directly so cookies are set in a
    // first-party context (modern browsers block 3P cookies on XHR/fetch).
    const wantsRedirect =
      String(req.query?.mode || '').toLowerCase() === 'redirect' ||
      String(req.body?.response_mode || '').toLowerCase() === 'redirect' ||
      String(req.headers.accept || '').includes('text/html');

    if (wantsRedirect) {
      return res.redirect(303, redirectUrl.toString());
    }

    return res.json({ redirect_url: redirectUrl.toString() });
  } catch (error) {
    console.error('SSO login error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/sso/signup
 * Centralized signup endpoint for branded apps.
 */
router.post('/signup', brandResolver, async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod = 'S256',
      state,
      scope,
      brand_id: brandHint,
    } = req.body || {};

    if (!name || !email || !password || !clientId || !redirectUri || !codeChallenge || !state) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters',
      });
    }

    const client = await getSsoClient(clientId);
    if (!client) return res.status(400).json({ error: 'invalid_client' });
    if (!isAllowedRedirectUri(redirectUri, client.redirect_uris)) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }

    const litBrandId = await getLitBrandId();
    if (!litBrandId) return res.status(500).json({ error: 'server_error' });

    const emailLower = String(email).toLowerCase().trim();
    const existingAny = await db.one(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [emailLower]
    );
    if (existingAny) {
      return res.status(409).json({ error: 'email_exists' });
    }

    const { first_name, last_name } = splitName(name);
    const passwordHash = await bcrypt.hash(password, 10);
    const coreUserId = crypto.randomUUID();

    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, role, brand_id, password_hash, credits)
       VALUES ($1, $2, $3, $4, 'student', $5, $6, 100)`,
      [coreUserId, emailLower, first_name, last_name, litBrandId, passwordHash]
    );

    const targetBrandId = (await resolveBrandId(brandHint)) || req.brandId || client.brand_id;
    if (!targetBrandId) return res.status(400).json({ error: 'invalid_brand' });

    const sessionToken = generateRandomString(32);
    const sessionHash = await bcrypt.hash(sessionToken, 10);
    await db.query(
      `INSERT INTO sso_sessions (session_token, core_user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4)
       ON CONFLICT (core_user_id) DO UPDATE SET
         session_token = EXCLUDED.session_token,
         expires_at = EXCLUDED.expires_at,
         last_used_at = NOW()`,
      [sessionHash, coreUserId, req.ip, req.headers['user-agent']]
    );

    setSsoSessionCookie(res, req, sessionToken);

    const authCode = await issueAuthCode({
      clientId,
      brandId: targetBrandId,
      coreUserId,
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      scope,
      state,
    });

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    redirectUrl.searchParams.set('state', state);

    const wantsRedirect =
      String(req.query?.mode || '').toLowerCase() === 'redirect' ||
      String(req.body?.response_mode || '').toLowerCase() === 'redirect' ||
      String(req.headers.accept || '').includes('text/html');

    if (wantsRedirect) {
      return res.redirect(303, redirectUrl.toString());
    }

    return res.json({ redirect_url: redirectUrl.toString() });
  } catch (error) {
    console.error('SSO signup error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Helper to generate auth code and redirect URL
 */
async function generateAuthCodeAndRedirect(client_id, brand_id, core_user_id, code_challenge, code_challenge_method, redirect_uri, state) {
  const authCode = generateRandomString(32);

  await db.query(
    `INSERT INTO sso_auth_codes 
     (code, client_id, brand_id, core_user_id, code_challenge, code_challenge_method, 
      redirect_uri, state, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '5 minutes')`,
    [authCode, client_id, brand_id, core_user_id,
      code_challenge, code_challenge_method, redirect_uri, state]
  );

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', authCode);
  if (state) redirectUrl.searchParams.set('state', state);

  return redirectUrl.toString();
}

/**
 * POST /api/sso/signup
 * Centralized signup for SSO
 */
router.post('/signup', brandResolver, async (req, res) => {
  try {
    const {
      name, email, password,
      client_id, redirect_uri,
      code_challenge, code_challenge_method = 'S256',
      state
    } = req.body;

    if (!email || !password || !client_id || !redirect_uri || !code_challenge) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters'
      });
    }

    // 1. Validate client
    const client = await db.one('SELECT * FROM sso_clients WHERE id = $1 AND active = true', [client_id]);
    if (!client) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    // 2. Register user
    const emailLower = String(email).toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);

    const nameParts = (name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    // Create or get core user
    let coreUser = await db.one('SELECT id FROM core_users WHERE email = $1', [emailLower]);
    let coreUserId;
    if (!coreUser) {
      coreUserId = crypto.randomUUID();
      await db.query(
        `INSERT INTO core_users (id, email, first_name, last_name, password_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [coreUserId, emailLower, firstName, lastName, passwordHash]
      );
    } else {
      coreUserId = coreUser.id;
    }

    // Create brand user for the current brand
    await db.query(
      `INSERT INTO brand_users (id, core_user_id, brand_id, first_name, last_name, email, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, 'student', $7)
       ON CONFLICT (core_user_id, brand_id) DO NOTHING`,
      [crypto.randomUUID(), coreUserId, req.brandId, firstName, lastName, emailLower, passwordHash]
    );

    // 3. Create SSO session
    const sessionToken = generateRandomString(32);
    const sessionHash = await bcrypt.hash(sessionToken, 10);

    await db.query(
      `INSERT INTO sso_sessions (session_token, core_user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4)
       ON CONFLICT (core_user_id) DO UPDATE SET
         session_token = EXCLUDED.session_token,
         expires_at = EXCLUDED.expires_at,
         last_used_at = NOW()`,
      [sessionHash, coreUserId, req.ip, req.headers['user-agent']]
    );

    // 4. Generate Auth Code and Redirect
    const redirect_url = await generateAuthCodeAndRedirect(
      client_id, req.brandId, coreUserId,
      code_challenge, code_challenge_method,
      redirect_uri, state
    );

    // 5. Set SSO cookie
    res.cookie('sso_session', sessionToken, {
      domain: process.env.COOKIE_DOMAIN || '.litsuite.app',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });

    res.json({ success: true, redirect_url });

  } catch (error) {
    console.error('SSO signup error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/sso/login
 * Centralized login for SSO
 */
router.post('/login', brandResolver, async (req, res) => {
  try {
    const {
      email, password,
      client_id, redirect_uri,
      code_challenge, code_challenge_method = 'S256',
      state
    } = req.body;

    if (!email || !password || !client_id || !redirect_uri || !code_challenge) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters'
      });
    }

    // 1. Validate client
    const client = await db.one('SELECT * FROM sso_clients WHERE id = $1 AND active = true', [client_id]);
    if (!client) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    // 2. Verify credentials
    const emailLower = String(email).toLowerCase().trim();
    const coreUser = await db.one(
      'SELECT id, password_hash FROM core_users WHERE email = $1',
      [emailLower]
    );

    if (!coreUser || !(await bcrypt.compare(password, coreUser.password_hash))) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // Ensure brand user exists
    await db.query(
      `INSERT INTO brand_users (id, core_user_id, brand_id, first_name, last_name, email, role, password_hash)
       SELECT $1, $2, $3, first_name, last_name, email, 'student', password_hash
       FROM core_users WHERE id = $2
       ON CONFLICT (core_user_id, brand_id) DO NOTHING`,
      [crypto.randomUUID(), coreUser.id, req.brandId]
    );

    // 3. Create SSO session
    const sessionToken = generateRandomString(32);
    const sessionHash = await bcrypt.hash(sessionToken, 10);

    await db.query(
      `INSERT INTO sso_sessions (session_token, core_user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4)
       ON CONFLICT (core_user_id) DO UPDATE SET
         session_token = EXCLUDED.session_token,
         expires_at = EXCLUDED.expires_at,
         last_used_at = NOW()`,
      [sessionHash, coreUser.id, req.ip, req.headers['user-agent']]
    );

    // 4. Generate Auth Code and Redirect
    const redirect_url = await generateAuthCodeAndRedirect(
      client_id, req.brandId, coreUser.id,
      code_challenge, code_challenge_method,
      redirect_uri, state
    );

    // 5. Set SSO cookie
    res.cookie('sso_session', sessionToken, {
      domain: process.env.COOKIE_DOMAIN || '.litsuite.app',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });

    res.json({ success: true, redirect_url });

  } catch (error) {
    console.error('SSO login error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/sso/initiate
 * Initiate seamless SSO after successful login
 * Called by brand backend after validating user credentials
 * 
 * Body:
 * - user_id: The user ID that just logged in
 * - client_id: The OAuth client ID (e.g., 'ttv-web')
 */
router.post('/initiate', brandResolver, async (req, res) => {
  try {
    const { user_id, client_id } = req.body;

    if (!user_id || !client_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'user_id and client_id required'
      });
    }

    // Get user
    const user = await db.one(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1 AND brand_id = $2',
      [user_id, req.brandId]
    );

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // Generate SSO session token
    const sessionToken = generateRandomString(32);
    const sessionHash = await bcrypt.hash(sessionToken, 10);

    // Create SSO session
    await db.query(
      `INSERT INTO sso_sessions (session_token, core_user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4)
       ON CONFLICT (core_user_id) DO UPDATE SET
         session_token = EXCLUDED.session_token,
         expires_at = EXCLUDED.expires_at,
         last_used_at = NOW()`,
      [sessionHash, user.id, req.ip, req.headers['user-agent']]
    );

    // Return SSO cookie info for frontend to set on litsuite.app domain
    res.json({
      success: true,
      sso_cookie: {
        name: 'sso_session',
        value: sessionToken,
        domain: '.litsuite.app', // Shared across all subdomains
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        secure: true,
        sameSite: 'None' // Required for cross-domain
      },
      sso_domain: LITSUITE_DOMAIN
    });

  } catch (error) {
    console.error('SSO initiate error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * GET /api/sso/authorize
 * OAuth 2.0 Authorization Endpoint
 * 
 * This is the entry point for seamless SSO:
 * 1. User visits Brand B
 * 2. Brand B redirects to litsuite.app/api/sso/authorize
 * 3. litsuite.app checks for SSO cookie
 * 4. If valid -> immediately redirect back with auth code (invisible!)
 * 5. If invalid -> redirect to brand login page
 */
router.get('/authorize', async (req, res) => {
  try {
    const {
      client_id,
      redirect_uri,
      response_type = 'code',
      scope = 'openid profile email',
      state,
      code_challenge,
      code_challenge_method = 'S256',
      brand_id
    } = req.query;

    // Validate required params
    if (!client_id || !redirect_uri || !code_challenge) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters'
      });
    }

    if (response_type !== 'code') {
      return res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only code response type supported'
      });
    }

    // Get client
    const client = await db.one(
      'SELECT * FROM sso_clients WHERE id = $1 AND active = true',
      [client_id]
    );

    if (!client) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    // Check redirect_uri
    const allowedUris = client.redirect_uris || [];
    if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }

    // Check for SSO session cookie
    const sessionCookie = getCookie(req, SESSION_COOKIE_NAME);
    if (sessionCookie) {
      // Validate session
      const sessions = await db.many(
        'SELECT * FROM sso_sessions WHERE revoked = false AND expires_at > NOW()'
      );

      let validSession = null;
      for (const session of sessions) {
        if (await bcrypt.compare(sessionCookie, session.session_token)) {
          validSession = session;
          break;
        }
      }

      if (validSession) {
        // Session valid! Generate auth code immediately (invisible to user)
        const targetBrandId = (await resolveBrandId(brand_id)) || client.brand_id;
        if (!targetBrandId) {
          return res.status(400).json({ error: 'invalid_brand' });
        }
        const authCode = generateRandomString(32);

        await db.query(
          `INSERT INTO sso_auth_codes 
           (code, client_id, brand_id, core_user_id, code_challenge, code_challenge_method, 
            redirect_uri, scope, state, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + INTERVAL '60 seconds')`,
          [authCode, client_id, targetBrandId, validSession.core_user_id,
           code_challenge, code_challenge_method, redirect_uri, scope, state]
        );

        // Update last used
        await db.query(
          'UPDATE sso_sessions SET last_used_at = NOW() WHERE id = $1',
          [validSession.id]
        );

        // Redirect back to brand with code (SEAMLESS!)
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('code', authCode);
        if (state) redirectUrl.searchParams.set('state', state);

        return res.redirect(redirectUrl.toString());
      }
    }

    // No valid session - redirect to login page with return URL
    // The brand will handle login and then redirect back through SSO
    const loginRedirect = new URL(redirect_uri);
    loginRedirect.searchParams.set('sso_login_required', 'true');
    loginRedirect.searchParams.set('sso_return_url', req.originalUrl);
    if (state) loginRedirect.searchParams.set('state', state);

    return res.redirect(loginRedirect.toString());

  } catch (error) {
    console.error('SSO authorize error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/sso/token
 * Exchange authorization code for access token
 * Called by brand backend after receiving callback
 */
router.post('/token', brandResolver, async (req, res) => {
  try {
    // Supports both JSON and urlencoded bodies.
    const grant_type = req.body?.grant_type;
    const code = req.body?.code;
    const redirect_uri = req.body?.redirect_uri;
    const code_verifier = req.body?.code_verifier;
    const client_id = req.body?.client_id;
    if (grant_type !== 'authorization_code') {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code supported'
      });
    }

    if (!code || !redirect_uri || !code_verifier || !client_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters'
      });
    }

    // Get auth code
    const authCode = await db.one(
      `SELECT * FROM sso_auth_codes 
       WHERE code = $1 AND used = false AND expires_at > NOW()`,
      [code]
    );

    if (!authCode) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code'
      });
    }

    // Verify client
    if (authCode.client_id !== client_id) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    // Verify redirect_uri (exact string match is brittle because browsers normalize URL encoding).
    if (normalizeRedirectUri(authCode.redirect_uri) !== normalizeRedirectUri(redirect_uri)) {
      return res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uri does not match the original request',
      });
    }

    // Verify PKCE
    const challenge = generateCodeChallenge(code_verifier);
    if (challenge !== authCode.code_challenge) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid code verifier'
      });
    }

    // Mark code as used
    await db.query(
      'UPDATE sso_auth_codes SET used = true, used_at = NOW() WHERE code = $1',
      [code]
    );
    // Get or create user for the target brand stored in the auth code.
    const targetBrandId = authCode.brand_id;
    let user = await db.one(
      'SELECT * FROM users WHERE id = $1 AND brand_id = $2',
      [authCode.core_user_id, targetBrandId]
    );

    if (!user) {
      // Get core user details
      const coreUser = await db.one(
        'SELECT email, first_name, last_name FROM users WHERE id = $1',
        [authCode.core_user_id]
      );

      // Create user for this brand
      const newUserId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, first_name, last_name, role, brand_id, credits)
         VALUES ($1, $2, $3, $4, 'student', $5, 100)`,
        [newUserId, coreUser.email, coreUser.first_name, coreUser.last_name, targetBrandId]
      );

      user = await db.one('SELECT * FROM users WHERE id = $1', [newUserId]);
    }

    // Generate JWT
    const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
    const brandRow = await db.one('SELECT code FROM brands WHERE id = $1', [targetBrandId]);
    const brandCode = brandRow?.code || req.brandCode;
    const accessToken = jwt.sign(
      {
        type: 'access',
        userId: user.id,
        coreUserId: authCode.core_user_id,
        email: user.email,
        role: user.role,
        brandId: targetBrandId,
        brandCode
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 604800, // 7 days
      scope: authCode.scope
    });

  } catch (error) {
    console.error('SSO token error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/sso/logout
 * Logout from SSO (revokes session)
 */
router.post('/logout', async (req, res) => {
  try {
    const sessionCookie = getCookie(req, SESSION_COOKIE_NAME);
    if (sessionCookie) {
      // Find and revoke session
      const sessions = await db.many('SELECT * FROM sso_sessions WHERE revoked = false');

      for (const session of sessions) {
        if (await bcrypt.compare(sessionCookie, session.session_token)) {
          await db.query(
            'UPDATE sso_sessions SET revoked = true, revoked_at = NOW() WHERE id = $1',
            [session.id]
          );
          break;
        }
      }
    }

    // Clear cookie
    clearSsoSessionCookie(res, req);
    res.json({ success: true, message: 'Logged out from SSO' });

  } catch (error) {
    console.error('SSO logout error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * GET /api/sso/check
 * Check if user has valid SSO session
 * Used by brands to auto-login users
 */
router.get('/check', async (req, res) => {
  try {
    const sessionCookie = getCookie(req, SESSION_COOKIE_NAME);
    if (!sessionCookie) {
      return res.json({ has_session: false });
    }

    // Find valid session
    const sessions = await db.many(
      'SELECT s.*, u.email, u.first_name, u.last_name FROM sso_sessions s ' +
      'JOIN users u ON s.core_user_id = u.id ' +
      'WHERE s.revoked = false AND s.expires_at > NOW()'
    );

    for (const session of sessions) {
      if (await bcrypt.compare(sessionCookie, session.session_token)) {
        // Update last used
        await db.query(
          'UPDATE sso_sessions SET last_used_at = NOW() WHERE id = $1',
          [session.id]
        );

        return res.json({
          has_session: true,
          user: {
            id: session.core_user_id,
            email: session.email,
            first_name: session.first_name,
            last_name: session.last_name
          }
        });
      }
    }

    res.json({ has_session: false });

  } catch (error) {
    console.error('SSO check error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * GET /api/sso/.well-known/configuration
 * Discovery endpoint
 */
router.get('/.well-known/configuration', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}/api/sso`;

  res.json({
    issuer: LITSUITE_DOMAIN,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    logout_endpoint: `${baseUrl}/logout`,
    check_session_endpoint: `${baseUrl}/check`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256']
  });
});

export default router;
