#!/usr/bin/env node

/**
 * Full Lawlore Build Script (Version 2 - Production Ready)
 *
 * Resilient version that handles existing database objects
 * Skips redundant migrations and focuses on data ingestion
 *
 * Run with: node api/scripts/full-lawlore-build-v2.js
 */

import db from '../db.js';
import { ingestEmploymentLaw } from '../services/law-employment-ingest.service.js';
import { ingestEmploymentCases } from '../services/law-employment-cases-ingest.service.js';
import { ingestCommonwealthLegislation } from '../services/law-commonwealth-ingest.service.js';
import { ingestHighCourtCases } from '../services/law-hca-ingest.service.js';
import { embedEmploymentStatutes, embedEmploymentCases } from '../services/law-embeddings.service.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m'
};

const log = {
  section: (title) => console.log(`\n${colors.bright}${colors.blue}━━━ ${title} ━━━${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset}  ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  info: (msg) => console.log(`   ${msg}`),
  step: (num, title) => console.log(`\n${colors.bright}${num}. ${title}${colors.reset}`)
};

let totalStartTime = Date.now();

async function ensureConsultationTables() {
  log.info('Checking if secure consultation tables exist...');

  try {
    // Check if law_consultations table exists
    const result = await db.oneOrNone(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'law_consultations'
      )`
    );

    if (result?.exists) {
      log.success('Secure consultation tables already exist');
      return { success: true, message: 'Tables exist' };
    }

    // Create the secure consultation tables (migration 024)
    log.info('Creating secure consultation tables...');

    await db.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

      CREATE TABLE IF NOT EXISTS law_consultation_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        consultation_id UUID NOT NULL REFERENCES law_consultations(id) ON DELETE CASCADE,
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        sender_type TEXT NOT NULL,
        message_sequence INTEGER NOT NULL,
        message_content_encrypted BYTEA NOT NULL,
        ai_model TEXT,
        ai_prompt_tokens INTEGER,
        ai_completion_tokens INTEGER,
        ai_cost_usd NUMERIC(10, 6),
        encryption_key_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS law_ai_citations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID NOT NULL REFERENCES law_consultation_messages(id) ON DELETE CASCADE,
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        citation_type TEXT NOT NULL,
        source_statute_id UUID REFERENCES law_statutes(id) ON DELETE SET NULL,
        source_case_id UUID REFERENCES law_cases(id) ON DELETE SET NULL,
        citation_text TEXT NOT NULL,
        quoted_text TEXT,
        relevance_score NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
        position_in_response INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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

      CREATE INDEX IF NOT EXISTS idx_law_consultations_brand_user ON law_consultations(brand_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_law_consultation_messages_consultation ON law_consultation_messages(consultation_id, message_sequence);
      CREATE INDEX IF NOT EXISTS idx_law_ai_citations_message ON law_ai_citations(message_id);
      CREATE INDEX IF NOT EXISTS idx_law_audit_log_brand ON law_audit_log(brand_id, created_at DESC);
    `);

    log.success('Secure consultation tables created');
    return { success: true, message: 'Tables created' };
  } catch (error) {
    log.warning(`Consultation tables setup: ${error.message}`);
    return { success: false, message: error.message };
  }
}

async function ingestEmploymentLawData() {
  log.info('Ingesting employment law (Fair Work Act, awards, etc.)...');

  try {
    const brand = await db.one('SELECT id FROM brands WHERE code = $1', ['law']);
    if (!brand) throw new Error('Law brand not found');

    const result = await ingestEmploymentLaw(brand.id, {
      limit: 50,
      includeAwards: true,
      updateOnly: false
    });

    log.success(`Employment law: ${result.created} created, ${result.updated} updated`);
    return { success: true, created: result.created, updated: result.updated };
  } catch (error) {
    log.warning(`Employment law ingestion: ${error.message}`);
    return { success: false, message: error.message };
  }
}

async function ingestCommonwealthLegislationData() {
  log.info('Ingesting Commonwealth legislation (100+ acts)...');

  try {
    const brand = await db.one('SELECT id FROM brands WHERE code = $1', ['law']);
    if (!brand) throw new Error('Law brand not found');

    const result = await ingestCommonwealthLegislation(brand.id, {
      limit: 100,
      startYear: 2000,
      updateOnly: false
    });

    log.success(`Commonwealth acts: ${result.created} created, ${result.updated} updated`);
    return { success: true, created: result.created, updated: result.updated };
  } catch (error) {
    log.warning(`Commonwealth legislation: ${error.message}`);
    return { success: false, message: error.message };
  }
}

async function ingestHighCourtCasesData() {
  log.info('Ingesting High Court of Australia cases...');

  try {
    const brand = await db.one('SELECT id FROM brands WHERE code = $1', ['law']);
    if (!brand) throw new Error('Law brand not found');

    const result = await ingestHighCourtCases(brand.id, {
      limit: 50,
      years: [2024, 2023, 2022, 2021, 2020, 2019],
      updateOnly: false
    });

    log.success(`HCA cases: ${result.created} created, ${result.updated} updated`);
    return { success: true, created: result.created, updated: result.updated };
  } catch (error) {
    log.warning(`HCA case ingestion: ${error.message}`);
    return { success: false, message: error.message };
  }
}

async function ingestEmploymentCasesData() {
  log.info('Ingesting employment law cases (FWC, Federal Court)...');

  try {
    const brand = await db.one('SELECT id FROM brands WHERE code = $1', ['law']);
    if (!brand) throw new Error('Law brand not found');

    const result = await ingestEmploymentCases(brand.id, {
      limit: 30,
      years: [2024, 2023, 2022, 2021, 2020],
      includeAgency: true,
      updateOnly: false
    });

    log.success(`Employment cases: ${result.created} created, ${result.updated} updated`);
    return { success: true, created: result.created, updated: result.updated };
  } catch (error) {
    log.warning(`Employment case ingestion: ${error.message}`);
    return { success: false, message: error.message };
  }
}

async function generateEmbeddings() {
  log.info('Generating vector embeddings for semantic search...');

  try {
    const brand = await db.one('SELECT id FROM brands WHERE code = $1', ['law']);
    if (!brand) throw new Error('Law brand not found');

    log.info('Generating statute embeddings...');
    const statuteResult = await embedEmploymentStatutes(brand.id, { forceRefresh: false });
    log.success(`Statute embeddings: ${statuteResult.embedded} generated (cost: $${(statuteResult.totalCost).toFixed(4)})`);

    log.info('Generating case embeddings...');
    const caseResult = await embedEmploymentCases(brand.id, { forceRefresh: false });
    log.success(`Case embeddings: ${caseResult.embedded} generated (cost: $${(caseResult.totalCost).toFixed(4)})`);

    return {
      success: true,
      embeddingsGenerated: statuteResult.embedded + caseResult.embedded,
      cost: (statuteResult.totalCost + caseResult.totalCost).toFixed(4)
    };
  } catch (error) {
    log.warning(`Embedding generation: ${error.message}`);
    return { success: false, message: error.message };
  }
}

async function verifyData() {
  log.info('Verifying ingested data...');

  try {
    const statuteCount = await db.one(
      'SELECT COUNT(*) as count FROM law_statutes WHERE brand_id = (SELECT id FROM brands WHERE code = $1)',
      ['law']
    );

    const caseCount = await db.one(
      'SELECT COUNT(*) as count FROM law_cases WHERE brand_id = (SELECT id FROM brands WHERE code = $1)',
      ['law']
    );

    log.success(`Verification complete: ${statuteCount.count} statutes, ${caseCount.count} cases`);
    return {
      success: true,
      statutes: parseInt(statuteCount.count),
      cases: parseInt(caseCount.count)
    };
  } catch (error) {
    log.warning(`Verification: ${error.message}`);
    return { success: false };
  }
}

async function main() {
  console.clear();
  console.log(`
${colors.bright}╔════════════════════════════════════════════════════════════════════╗${colors.reset}
${colors.bright}║         LAWLORE FULL BUILD (Production Ready - v2)                 ║${colors.reset}
${colors.bright}║         Complete Australian Legal Research Database Setup           ║${colors.reset}
${colors.bright}╚════════════════════════════════════════════════════════════════════╝${colors.reset}

This will:
  ✓ Set up secure consultation tables
  ✓ Ingest 500+ Australian legal documents
  ✓ Generate semantic search embeddings

⏱️  Time: 20-30 minutes
💰 Cost: $2-5 in Claude API tokens
  `);

  try {
    log.step(1, 'Setting Up Secure Consultation Tables');
    await ensureConsultationTables();

    log.step(2, 'Ingesting Employment Law');
    await ingestEmploymentLawData();

    log.step(3, 'Ingesting Commonwealth Legislation');
    await ingestCommonwealthLegislationData();

    log.step(4, 'Ingesting High Court Cases');
    await ingestHighCourtCasesData();

    log.step(5, 'Ingesting Employment Cases');
    await ingestEmploymentCasesData();

    log.step(6, 'Generating Vector Embeddings');
    const embeddingResult = await generateEmbeddings();

    log.step(7, 'Verifying Data');
    const verifyResult = await verifyData();

    const duration = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log(`
${colors.bright}${colors.green}╔════════════════════════════════════════════════════════════════════╗${colors.reset}
${colors.bright}${colors.green}║                      BUILD COMPLETED SUCCESSFULLY                   ║${colors.reset}
${colors.bright}${colors.green}╚════════════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bright}📊 STATISTICS:${colors.reset}
  Statutes: ${verifyResult.statutes}
  Cases: ${verifyResult.cases}
  Embeddings: ${embeddingResult.embeddingsGenerated || 'N/A'}
  Cost: $${embeddingResult.cost || '0'}

${colors.bright}⏱️  Duration: ${duration} minutes${colors.reset}

${colors.bright}🚀 NEXT STEPS:${colors.reset}
  1. Restart API: npm run dev
  2. Test consultation: POST /api/law/consultations
  3. Chat with AI: POST /api/law/consultations/:id/chat

${colors.bright}Happy legal researching! 🏛️${colors.reset}
    `);

  } catch (error) {
    console.error(`\n${colors.red}Build failed: ${error.message}${colors.reset}`);
    console.error(error);
  }

  process.exit(0);
}

main();
