#!/usr/bin/env node

/**
 * Test Employment Law Ingest Service
 *
 * This script tests the employment law ingest endpoint by:
 * 1. Creating/getting a test user and brand
 * 2. Generating a JWT token
 * 3. Calling the ingest endpoint
 * 4. Verifying the data was inserted
 */

import db from './db.js';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const API_URL = 'http://localhost:1212';

// ============================================================================
// Test Data Setup
// ============================================================================

async function setupTestUser() {
  console.log('\n📋 Setting up test user and brand...');

  try {
    // Get or create lawlore brand
    let brand = await db.oneOrNone(
      `SELECT id FROM brands WHERE code = 'law'`
    );

    if (!brand) {
      const brandId = uuidv4();
      await db.query(
        `INSERT INTO brands (id, code, name, origins, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          brandId,
          'law',
          'Lawlore',
          JSON.stringify(['http://localhost:7777', 'https://lawlore.art']),
          JSON.stringify({
            theme: 'lawlore',
            primaryColor: '#1e3a8a'
          })
        ]
      );
      brand = { id: brandId };
      console.log('  ✓ Created lawlore brand');
    } else {
      console.log('  ✓ Using existing lawlore brand');
    }

    // Get or create test user
    let user = await db.oneOrNone(
      `SELECT * FROM "user" WHERE email = 'test-employment@lawlore.test'`
    );

    if (!user) {
      const userId = uuidv4();
      await db.query(
        `INSERT INTO "user" (id, email, role, "createdAt")
         VALUES ($1, $2, $3, NOW())`,
        [userId, 'test-employment@lawlore.test', 'admin']
      );
      user = { id: userId, email: 'test-employment@lawlore.test', role: 'admin' };
      console.log('  ✓ Created test user');
    } else {
      console.log('  ✓ Using existing test user');
    }

    return { brand, user };
  } catch (error) {
    console.error('  ✗ Setup error:', error.message);
    throw error;
  }
}

// ============================================================================
// Token Generation & Ingest Call
// ============================================================================

async function callIngestEndpoint(brandId, userId, userEmail) {
  console.log('\n🔑 Generating JWT token...');

  const token = jwt.sign(
    {
      userId: userId,
      email: userEmail,
      role: 'admin',
      brandId: brandId
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  console.log(`  ✓ Token generated (valid for 1 hour)`);

  console.log('\n🚀 Calling ingest endpoint...');
  console.log(`  POST ${API_URL}/api/law/ingest/employment`);

  try {
    const response = await fetch(`${API_URL}/api/law/ingest/employment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        limit: 10,
        includeAwards: true,
        updateOnly: false
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`  ✗ Error (${response.status}):`, data);
      return null;
    }

    console.log(`  ✓ Ingest succeeded!`);
    console.log(`    - Created: ${data.created}`);
    console.log(`    - Updated: ${data.updated}`);
    console.log(`    - Total: ${data.total}`);

    return data;
  } catch (error) {
    console.error(`  ✗ Request error:`, error.message);
    return null;
  }
}

// ============================================================================
// Verification
// ============================================================================

async function verifyData() {
  console.log('\n✅ Verifying ingested data...\n');

  try {
    // Check employment law sources
    const sources = await db.many(
      `SELECT code, name, sync_status, last_sync
       FROM law_sources
       WHERE code = 'fw_legislation'`
    );

    console.log(`📊 Employment Law Sources:`);
    if (sources.length === 0) {
      console.log('  (none found)');
    } else {
      sources.forEach(s => {
        console.log(`  • ${s.name}`);
        console.log(`    - Status: ${s.sync_status}`);
        console.log(`    - Last sync: ${s.last_sync || 'never'}`);
      });
    }

    // Check statutes ingested
    const statutes = await db.many(
      `SELECT title, year, jurisdiction, status
       FROM law_statutes
       WHERE title LIKE '%Fair Work%'
       OR title LIKE '%Discrimination%'
       OR title LIKE '%Award%'
       ORDER BY title`
    );

    console.log(`\n📚 Employment Law Statutes (${statutes.length} found):`);
    if (statutes.length === 0) {
      console.log('  (none found)');
    } else {
      statutes.forEach(s => {
        console.log(`  • ${s.title} (${s.year})`);
        console.log(`    - Jurisdiction: ${s.jurisdiction}, Status: ${s.status}`);
      });
    }

    // Check ingestion logs
    const logs = await db.many(
      `SELECT status, documents_created, documents_updated, error_message, started_at
       FROM law_ingestion_log
       WHERE status IN ('success', 'failed')
       ORDER BY started_at DESC
       LIMIT 3`
    );

    console.log(`\n📝 Ingestion Logs (recent):`);
    if (logs.length === 0) {
      console.log('  (no logs found)');
    } else {
      logs.forEach((log, i) => {
        const status = log.status === 'success' ? '✓' : '✗';
        console.log(`  ${status} ${log.status.toUpperCase()}`);
        console.log(`    - Created: ${log.documents_created}, Updated: ${log.documents_updated}`);
        if (log.error_message) console.log(`    - Error: ${log.error_message}`);
      });
    }

    return statutes.length > 0;
  } catch (error) {
    console.error('Verification error:', error.message);
    return false;
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log('🧪 Employment Law Ingest Service Test');
  console.log('=====================================\n');

  try {
    // 1. Setup
    const { brand, user } = await setupTestUser();

    // 2. Ingest
    const result = await callIngestEndpoint(brand.id, user.id, user.email);
    if (!result) {
      console.error('\n❌ Ingest failed');
      process.exit(1);
    }

    // 3. Verify
    const verified = await verifyData();

    // 4. Summary
    console.log('\n' + '='.repeat(50));
    if (verified) {
      console.log('✅ TEST PASSED - Employment law data ingested successfully!');
    } else {
      console.log('⚠️  TEST INCONCLUSIVE - Check database manually');
    }
    console.log('='.repeat(50));

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  }
}

main();
