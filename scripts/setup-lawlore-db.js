#!/usr/bin/env node

/**
 * Complete Lawlore Database Setup
 *
 * Creates all required tables and structures in one go:
 * 1. Base law tables (statutes, cases, sources, citations)
 * 2. Secure consultation tables (encrypted consultations + messages)
 * 3. Indexes and triggers
 *
 * Run: node api/scripts/setup-lawlore-db.js
 */

import db from '../db.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  info: (msg) => console.log(`  ${msg}`),
  section: (title) => console.log(`\n${colors.bright}${colors.blue}━ ${title}${colors.reset}`)
};

async function setupDatabase() {
  console.log(`
${colors.bright}${colors.blue}╔════════════════════════════════════════════════════════════════╗${colors.reset}
${colors.bright}${colors.blue}║          LAWLORE DATABASE SETUP - COMPLETE INITIALIZATION        ║${colors.reset}
${colors.bright}${colors.blue}╚════════════════════════════════════════════════════════════════╝${colors.reset}
  `);

  try {
    // Step 1: Enable Extensions
    log.section('Step 1: Enabling PostgreSQL Extensions');
    log.info('Enabling pgcrypto for encryption...');
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    log.success('pgcrypto extension enabled');

    // Step 2: Ensure law brand exists
    log.section('Step 2: Setting Up Law Brand');
    log.info('Creating law brand...');
    await db.query(`
      INSERT INTO brands (code, name, origins, data)
      VALUES (
        'law',
        'Lawlore',
        '["http://localhost:7777","https://lawlore.art","https://www.lawlore.art"]'::jsonb,
        '{
          "theme": "lawlore",
          "primaryColor": "#1e3a8a",
          "secondaryColor": "#0f766e",
          "description": "Australian legal research and statute law search"
        }'::jsonb
      )
      ON CONFLICT (code) DO NOTHING;
    `);
    log.success('Law brand ready');

    // Step 3: Create BASE law tables
    log.section('Step 3: Creating Base Law Tables');

    log.info('Creating law_sources table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('legislation', 'cases')),
        api_endpoint TEXT,
        last_sync TIMESTAMPTZ,
        sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'success', 'failed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (brand_id, code)
      );
    `);
    log.success('law_sources table created');

    log.info('Creating law_statutes table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_statutes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        source_id UUID NOT NULL REFERENCES law_sources(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        short_title TEXT,
        content TEXT NOT NULL,
        content_tsvector tsvector,
        jurisdiction TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'repealed', 'superseded')),
        year INTEGER,
        version_no INTEGER DEFAULT 1,
        effective_date DATE,
        repeal_date DATE,
        url TEXT,
        sections JSONB DEFAULT '[]'::jsonb,
        amendments JSONB DEFAULT '[]'::jsonb,
        embedding vector(1536),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log.success('law_statutes table created');

    log.info('Creating law_cases table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        source_id UUID NOT NULL REFERENCES law_sources(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        citation TEXT NOT NULL,
        citations JSONB DEFAULT '[]'::jsonb,
        content TEXT NOT NULL,
        content_tsvector tsvector,
        court TEXT NOT NULL,
        judges JSONB DEFAULT '[]'::jsonb,
        year INTEGER,
        headnotes TEXT,
        holding TEXT,
        jurisdiction TEXT NOT NULL,
        url TEXT,
        embedding vector(1536),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (brand_id, citation)
      );
    `);
    log.success('law_cases table created');

    log.info('Creating law_citations table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_citations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        source_statute_id UUID REFERENCES law_statutes(id) ON DELETE CASCADE,
        source_case_id UUID REFERENCES law_cases(id) ON DELETE CASCADE,
        target_statute_id UUID REFERENCES law_statutes(id) ON DELETE CASCADE,
        target_case_id UUID REFERENCES law_cases(id) ON DELETE CASCADE,
        citation_text TEXT,
        citation_type TEXT DEFAULT 'reference' CHECK (citation_type IN ('reference', 'amendment', 'repeal', 'supersede')),
        confidence_score NUMERIC(3, 2) DEFAULT 1.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log.success('law_citations table created');

    log.info('Creating law_search_history table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_search_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        user_id UUID REFERENCES core_users(id) ON DELETE SET NULL,
        query TEXT NOT NULL,
        filters JSONB DEFAULT '{}'::jsonb,
        result_count INTEGER DEFAULT 0,
        search_type TEXT DEFAULT 'search' CHECK (search_type IN ('search', 'browse', 'direct')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log.success('law_search_history table created');

    log.info('Creating law_ingestion_log table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_ingestion_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        source_id UUID NOT NULL REFERENCES law_sources(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed')),
        documents_processed INTEGER DEFAULT 0,
        documents_created INTEGER DEFAULT 0,
        documents_updated INTEGER DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        duration_seconds INTEGER
      );
    `);
    log.success('law_ingestion_log table created');

    // Step 4: Create SECURE consultation tables
    log.section('Step 4: Creating Secure Consultation Tables');

    log.info('Creating law_encryption_keys table...');
    await db.query(`
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
    `);
    log.success('law_encryption_keys table created');

    log.info('Creating law_consultations table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_consultations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        jurisdiction TEXT NOT NULL,
        case_type TEXT NOT NULL,
        case_title_encrypted BYTEA NOT NULL,
        facts_encrypted BYTEA NOT NULL,
        legal_questions_encrypted BYTEA NOT NULL,
        is_privileged BOOLEAN NOT NULL DEFAULT true,
        confidentiality_level TEXT NOT NULL DEFAULT 'high',
        legal_hold BOOLEAN NOT NULL DEFAULT false,
        encryption_key_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ
      );
    `);
    log.success('law_consultations table created');

    log.info('Creating law_consultation_messages table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_consultation_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        consultation_id UUID NOT NULL REFERENCES law_consultations(id) ON DELETE CASCADE,
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'ai')),
        message_sequence INTEGER NOT NULL,
        message_content_encrypted BYTEA NOT NULL,
        ai_model TEXT,
        ai_prompt_tokens INTEGER,
        ai_completion_tokens INTEGER,
        ai_cost_usd NUMERIC(10, 6),
        encryption_key_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log.success('law_consultation_messages table created');

    log.info('Creating law_ai_citations table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_ai_citations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID NOT NULL REFERENCES law_consultation_messages(id) ON DELETE CASCADE,
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        citation_type TEXT NOT NULL CHECK (citation_type IN ('statute', 'case')),
        source_statute_id UUID REFERENCES law_statutes(id) ON DELETE SET NULL,
        source_case_id UUID REFERENCES law_cases(id) ON DELETE SET NULL,
        citation_text TEXT NOT NULL,
        quoted_text TEXT,
        relevance_score NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
        position_in_response INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log.success('law_ai_citations table created');

    log.info('Creating law_consultation_access table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_consultation_access (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        consultation_id UUID NOT NULL REFERENCES law_consultations(id) ON DELETE CASCADE,
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        access_level TEXT NOT NULL DEFAULT 'read',
        granted_by UUID REFERENCES core_users(id) ON DELETE SET NULL,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        UNIQUE(consultation_id, user_id)
      );
    `);
    log.success('law_consultation_access table created');

    log.info('Creating law_audit_log table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        user_id UUID REFERENCES core_users(id) ON DELETE SET NULL,
        user_email TEXT,
        user_role TEXT,
        user_ip_address INET,
        user_agent TEXT,
        action_type TEXT NOT NULL,
        resource_type TEXT,
        resource_id UUID,
        action_metadata JSONB DEFAULT '{}',
        action_result TEXT,
        failure_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log.success('law_audit_log table created');

    log.info('Creating law_consultation_stats table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_consultation_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        consultation_id UUID NOT NULL REFERENCES law_consultations(id) ON DELETE CASCADE,
        total_user_messages INTEGER NOT NULL DEFAULT 0,
        total_ai_messages INTEGER NOT NULL DEFAULT 0,
        total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
        total_completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
        first_message_at TIMESTAMPTZ,
        last_message_at TIMESTAMPTZ,
        average_response_time_seconds INTEGER,
        total_citations INTEGER NOT NULL DEFAULT 0,
        statute_citations INTEGER NOT NULL DEFAULT 0,
        case_citations INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log.success('law_consultation_stats table created');

    log.info('Creating law_consultation_retention table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS law_consultation_retention (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        consultation_id UUID NOT NULL UNIQUE REFERENCES law_consultations(id) ON DELETE CASCADE,
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        retention_years INTEGER NOT NULL DEFAULT 7,
        retention_reason TEXT,
        legal_hold BOOLEAN NOT NULL DEFAULT false,
        legal_hold_reason TEXT,
        legal_hold_expires_at TIMESTAMPTZ,
        deletion_scheduled_at TIMESTAMPTZ,
        deletion_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    log.success('law_consultation_retention table created');

    // Step 5: Create indexes
    log.section('Step 5: Creating Indexes');

    const indexes = [
      ['law_sources', 'brand_id'],
      ['law_statutes', 'brand_id, jurisdiction'],
      ['law_statutes', 'content_tsvector USING GIN'],
      ['law_cases', 'brand_id, year DESC'],
      ['law_cases', 'content_tsvector USING GIN'],
      ['law_consultations', 'brand_id, user_id'],
      ['law_consultations', 'status'],
      ['law_consultation_messages', 'consultation_id, message_sequence'],
      ['law_ai_citations', 'message_id'],
      ['law_audit_log', 'brand_id, created_at DESC'],
      ['law_consultation_access', 'consultation_id'],
    ];

    for (const [table, columns] of indexes) {
      const indexName = `idx_${table}_${columns.replace(/[, ]/g, '_').substring(0, 20)}`;
      try {
        await db.query(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}(${columns});`);
        log.info(`Index created: ${indexName}`);
      } catch (e) {
        log.info(`Index already exists or error: ${indexName}`);
      }
    }

    // Step 6: Create triggers
    log.section('Step 6: Creating Triggers');

    log.info('Creating tsvector triggers for law_statutes...');
    await db.query(`
      CREATE OR REPLACE FUNCTION law_statutes_tsvector_update()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.content_tsvector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.short_title, '') || ' ' || COALESCE(NEW.content, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS law_statutes_tsvector_trigger ON law_statutes;
      CREATE TRIGGER law_statutes_tsvector_trigger
      BEFORE INSERT OR UPDATE ON law_statutes
      FOR EACH ROW
      EXECUTE FUNCTION law_statutes_tsvector_update();
    `);
    log.success('law_statutes tsvector trigger created');

    log.info('Creating tsvector triggers for law_cases...');
    await db.query(`
      CREATE OR REPLACE FUNCTION law_cases_tsvector_update()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.content_tsvector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.citation, '') || ' ' || COALESCE(NEW.content, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS law_cases_tsvector_trigger ON law_cases;
      CREATE TRIGGER law_cases_tsvector_trigger
      BEFORE INSERT OR UPDATE ON law_cases
      FOR EACH ROW
      EXECUTE FUNCTION law_cases_tsvector_update();
    `);
    log.success('law_cases tsvector trigger created');

    log.info('Creating update timestamp triggers...');
    await db.query(`
      CREATE OR REPLACE FUNCTION law_update_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at := NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS law_consultations_update_trigger ON law_consultations;
      CREATE TRIGGER law_consultations_update_trigger
      BEFORE UPDATE ON law_consultations
      FOR EACH ROW
      EXECUTE FUNCTION law_update_timestamp();

      DROP TRIGGER IF EXISTS law_consultation_retention_update_trigger ON law_consultation_retention;
      CREATE TRIGGER law_consultation_retention_update_trigger
      BEFORE UPDATE ON law_consultation_retention
      FOR EACH ROW
      EXECUTE FUNCTION law_update_timestamp();
    `);
    log.success('Update timestamp triggers created');

    // Step 7: Seed law sources
    log.section('Step 7: Seeding Law Sources');

    const lawBrand = await db.one('SELECT id FROM brands WHERE code = $1', ['law']);
    if (lawBrand) {
      log.info('Creating law sources...');
      await db.query(`
        INSERT INTO law_sources (brand_id, code, name, jurisdiction, source_type, api_endpoint)
        VALUES
          ($1, 'cth_acts', 'Commonwealth Acts', 'cth', 'legislation', 'https://legislation.gov.au'),
          ($1, 'cth_regs', 'Commonwealth Regulations', 'cth', 'legislation', 'https://legislation.gov.au'),
          ($1, 'hca_cases', 'High Court of Australia', 'hca', 'cases', 'https://austlii.edu.au'),
          ($1, 'employment_law', 'Employment Law', 'cth', 'legislation', 'https://www.fwc.gov.au'),
          ($1, 'employment_cases', 'Employment Cases', 'cth', 'cases', 'https://www.fwc.gov.au')
        ON CONFLICT (brand_id, code) DO NOTHING;
      `, [lawBrand.id]);
      log.success('Law sources created');
    }

    // Success message
    console.log(`
${colors.bright}${colors.green}╔════════════════════════════════════════════════════════════════╗${colors.reset}
${colors.bright}${colors.green}║               DATABASE SETUP COMPLETED SUCCESSFULLY              ║${colors.reset}
${colors.bright}${colors.green}╚════════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bright}✅ All tables created:${colors.reset}
  • law_sources, law_statutes, law_cases, law_citations
  • law_consultations, law_consultation_messages, law_ai_citations
  • law_consultation_access, law_audit_log, law_consultation_stats
  • law_encryption_keys, law_consultation_retention

${colors.bright}✅ All indexes created${colors.reset}

${colors.bright}✅ All triggers created${colors.reset}

${colors.bright}Next step:${colors.reset} Run the data ingestion
  node api/scripts/full-lawlore-build-v2.js
    `);

    process.exit(0);

  } catch (error) {
    console.error(`\n${colors.red}${colors.bright}Setup failed:${colors.reset} ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

setupDatabase();
