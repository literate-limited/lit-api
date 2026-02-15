-- Migration 024: Lawlore AI Secure Legal Consultations
-- Adds encrypted consultation system with attorney-client privilege protection
-- Includes: consultations, encrypted messages, AI citations, audit logging, access control

-- Enable pgcrypto extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Encryption Key Management
-- ---------------------------------------------------------------------------
-- Tracks encryption key versions for key rotation support
CREATE TABLE IF NOT EXISTS law_encryption_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(brand_id, key_version)
);

CREATE INDEX IF NOT EXISTS idx_law_encryption_keys_brand_active
  ON law_encryption_keys(brand_id, is_active);

-- ---------------------------------------------------------------------------
-- Legal Consultations (Encrypted Case Intake)
-- ---------------------------------------------------------------------------
-- Stores encrypted consultation metadata for attorney-client privilege
CREATE TABLE IF NOT EXISTS law_consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Basic case information
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN (
    'cth', 'nsw', 'vic', 'qld', 'sa', 'wa', 'tas', 'nt', 'act'
  )),
  case_type TEXT NOT NULL CHECK (case_type IN (
    'criminal', 'civil', 'family', 'employment', 'commercial', 'property',
    'administrative', 'constitutional', 'other'
  )),

  -- Encrypted sensitive fields (stored as bytea from pgcrypto)
  case_title_encrypted BYTEA NOT NULL,
  facts_encrypted BYTEA NOT NULL,
  legal_questions_encrypted BYTEA NOT NULL,

  -- Privilege and compliance tracking
  is_privileged BOOLEAN NOT NULL DEFAULT true,
  confidentiality_level TEXT NOT NULL DEFAULT 'high' CHECK (
    confidentiality_level IN ('normal', 'high', 'extreme')
  ),
  legal_hold BOOLEAN NOT NULL DEFAULT false,

  -- Encryption metadata
  encryption_key_version INTEGER NOT NULL DEFAULT 1,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('draft', 'active', 'closed', 'archived')
  ),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_law_consultations_brand_user
  ON law_consultations(brand_id, user_id);
CREATE INDEX IF NOT EXISTS idx_law_consultations_brand_status
  ON law_consultations(brand_id, status);
CREATE INDEX IF NOT EXISTS idx_law_consultations_created
  ON law_consultations(brand_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Encrypted Chat Messages (Consultation Messages)
-- ---------------------------------------------------------------------------
-- Stores encrypted messages in consultation conversations
CREATE TABLE IF NOT EXISTS law_consultation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES law_consultations(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- Message metadata
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'ai')),
  message_sequence INTEGER NOT NULL,

  -- Encrypted message content
  message_content_encrypted BYTEA NOT NULL,

  -- AI metadata (for AI-generated messages)
  ai_model TEXT,
  ai_prompt_tokens INTEGER,
  ai_completion_tokens INTEGER,
  ai_cost_usd NUMERIC(10, 6),

  -- Encryption metadata
  encryption_key_version INTEGER NOT NULL DEFAULT 1,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_consultation_messages_consultation
  ON law_consultation_messages(consultation_id, message_sequence);
CREATE INDEX IF NOT EXISTS idx_law_consultation_messages_sender
  ON law_consultation_messages(consultation_id, sender_type);
CREATE INDEX IF NOT EXISTS idx_law_consultation_messages_created
  ON law_consultation_messages(brand_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- AI Response Citations (Source Attribution)
-- ---------------------------------------------------------------------------
-- Tracks which statutes and cases were cited in AI responses
CREATE TABLE IF NOT EXISTS law_ai_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES law_consultation_messages(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- Citation source (statute or case)
  citation_type TEXT NOT NULL CHECK (citation_type IN ('statute', 'case')),
  source_statute_id UUID REFERENCES law_statutes(id) ON DELETE SET NULL,
  source_case_id UUID REFERENCES law_cases(id) ON DELETE SET NULL,

  -- Citation details
  citation_text TEXT NOT NULL, -- Full AGLC format citation
  quoted_text TEXT, -- The actual text quoted from the source

  -- Relevance and position
  relevance_score NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
  position_in_response INTEGER, -- Position where cited appears in response

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_ai_citations_message
  ON law_ai_citations(message_id);
CREATE INDEX IF NOT EXISTS idx_law_ai_citations_statute
  ON law_ai_citations(source_statute_id);
CREATE INDEX IF NOT EXISTS idx_law_ai_citations_case
  ON law_ai_citations(source_case_id);
CREATE INDEX IF NOT EXISTS idx_law_ai_citations_brand
  ON law_ai_citations(brand_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Access Control (Consultation Permissions)
-- ---------------------------------------------------------------------------
-- Manages who can view/edit specific consultations
CREATE TABLE IF NOT EXISTS law_consultation_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES law_consultations(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Access level (read-only view, write, admin)
  access_level TEXT NOT NULL DEFAULT 'read' CHECK (
    access_level IN ('read', 'write', 'admin')
  ),

  -- Grant tracking for audit
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Revocation and expiration
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  UNIQUE(consultation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_law_consultation_access_consultation
  ON law_consultation_access(consultation_id, revoked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_law_consultation_access_user
  ON law_consultation_access(user_id, revoked_at IS NULL);

-- ---------------------------------------------------------------------------
-- Audit Logging (Compliance & Security)
-- ---------------------------------------------------------------------------
-- Logs ALL actions on consultations (no case content stored)
CREATE TABLE IF NOT EXISTS law_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- User information
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_role TEXT,

  -- Request information (for security analysis)
  user_ip_address INET,
  user_agent TEXT,

  -- Action details (NO sensitive data)
  action_type TEXT NOT NULL CHECK (action_type IN (
    'consultation_created', 'consultation_viewed', 'consultation_updated',
    'consultation_closed', 'message_sent', 'message_viewed',
    'citation_viewed', 'access_granted', 'access_revoked',
    'access_denied', 'audit_log_viewed', 'export_requested'
  )),

  -- Resource being acted upon
  resource_type TEXT CHECK (resource_type IN (
    'consultation', 'message', 'citation', 'access'
  )),
  resource_id UUID,

  -- Action details (metadata only, NO content)
  action_metadata JSONB DEFAULT '{}'::jsonb,

  -- Result
  action_result TEXT CHECK (action_result IN ('success', 'failure', 'denied')),
  failure_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_audit_log_brand
  ON law_audit_log(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_law_audit_log_user
  ON law_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_law_audit_log_resource
  ON law_audit_log(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_law_audit_log_action
  ON law_audit_log(action_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- Consultation Statistics (Analytics)
-- ---------------------------------------------------------------------------
-- Tracks consultation metrics for analytics (no PII)
CREATE TABLE IF NOT EXISTS law_consultation_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  consultation_id UUID NOT NULL REFERENCES law_consultations(id) ON DELETE CASCADE,

  -- Message counts
  total_user_messages INTEGER NOT NULL DEFAULT 0,
  total_ai_messages INTEGER NOT NULL DEFAULT 0,

  -- Token usage and costs
  total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  total_completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,

  -- Engagement metrics
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  average_response_time_seconds INTEGER,

  -- Citation metrics
  total_citations INTEGER NOT NULL DEFAULT 0,
  statute_citations INTEGER NOT NULL DEFAULT 0,
  case_citations INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_consultation_stats_consultation
  ON law_consultation_stats(consultation_id);
CREATE INDEX IF NOT EXISTS idx_law_consultation_stats_brand
  ON law_consultation_stats(brand_id);

-- ---------------------------------------------------------------------------
-- Data Retention Policy
-- ---------------------------------------------------------------------------
-- Tracks retention requirements and deletion dates
CREATE TABLE IF NOT EXISTS law_consultation_retention (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL UNIQUE REFERENCES law_consultations(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- Retention configuration
  retention_years INTEGER NOT NULL DEFAULT 7,
  retention_reason TEXT, -- e.g., 'legal_hold', 'statute_of_limitations', 'ongoing_litigation'

  -- Legal hold (prevents deletion)
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  legal_hold_reason TEXT,
  legal_hold_expires_at TIMESTAMPTZ,

  -- Deletion tracking
  deletion_scheduled_at TIMESTAMPTZ,
  deletion_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_consultation_retention_consultation
  ON law_consultation_retention(consultation_id);
CREATE INDEX IF NOT EXISTS idx_law_consultation_retention_deletion
  ON law_consultation_retention(deletion_scheduled_at);

-- ---------------------------------------------------------------------------
-- Update Timestamps Trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION law_consultations_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER law_consultations_update_trigger
BEFORE UPDATE ON law_consultations
FOR EACH ROW
EXECUTE FUNCTION law_consultations_update_timestamp();

CREATE OR REPLACE FUNCTION law_consultation_retention_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER law_consultation_retention_update_trigger
BEFORE UPDATE ON law_consultation_retention
FOR EACH ROW
EXECUTE FUNCTION law_consultation_retention_update_timestamp();

-- ---------------------------------------------------------------------------
-- Create default encryption key entry for the law brand
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  law_brand_id UUID;
BEGIN
  SELECT id INTO law_brand_id FROM brands WHERE code = 'law';
  IF law_brand_id IS NOT NULL THEN
    INSERT INTO law_encryption_keys (brand_id, key_version, algorithm, is_active)
    VALUES (law_brand_id, 1, 'aes-256-gcm', true)
    ON CONFLICT (brand_id, key_version) DO NOTHING;
  END IF;
END $$;
