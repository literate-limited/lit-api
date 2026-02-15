-- Migration 018: Seamless SSO Tables
-- OAuth 2.0 Authorization Code + PKCE with a global SSO session cookie.

-- ============================================================================
-- 1. sso_sessions - Central sessions (cookie token is hashed in DB)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sso_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT UNIQUE NOT NULL,
  core_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  revoked BOOLEAN DEFAULT false,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sso_sessions_token ON sso_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sso_sessions_user ON sso_sessions(core_user_id);
CREATE INDEX IF NOT EXISTS idx_sso_sessions_expires ON sso_sessions(expires_at);

-- ============================================================================
-- 2. sso_auth_codes - Short-lived auth codes (60s)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sso_auth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  core_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  code_challenge_method VARCHAR(10) DEFAULT 'S256',
  redirect_uri TEXT NOT NULL,
  scope TEXT DEFAULT 'openid profile email',
  state TEXT,
  used BOOLEAN DEFAULT false,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '60 seconds')
);

CREATE INDEX IF NOT EXISTS idx_sso_auth_codes_client ON sso_auth_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_sso_auth_codes_brand ON sso_auth_codes(brand_id);
CREATE INDEX IF NOT EXISTS idx_sso_auth_codes_expires ON sso_auth_codes(expires_at);

-- ============================================================================
-- 3. sso_clients - OAuth client registrations
-- ============================================================================
CREATE TABLE IF NOT EXISTS sso_clients (
  id TEXT PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
  secret_hash TEXT,
  require_pkce BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_clients_brand ON sso_clients(brand_id);
CREATE INDEX IF NOT EXISTS idx_sso_clients_active ON sso_clients(active);

