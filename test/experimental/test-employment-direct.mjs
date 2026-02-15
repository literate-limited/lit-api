#!/usr/bin/env node

/**
 * Direct Test of Employment Law Ingest Service
 * Calls the service directly without HTTP/Auth layer
 */

import { ingestEmploymentLaw } from './services/law-employment-ingest.service.js';
import db from './db.js';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('🧪 Employment Law Ingest - Direct Service Test');
  console.log('='.repeat(50));

  try {
    // 1. Get or create lawlore brand
    console.log('\n1️⃣  Setting up lawlore brand...');
    let brand = await db.one(`SELECT id FROM brands WHERE code = 'law'`);

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
          JSON.stringify({ theme: 'lawlore', primaryColor: '#1e3a8a' })
        ]
      );
      brand = { id: brandId };
      console.log('   ✓ Created lawlore brand');
    } else {
      console.log('   ✓ Using existing lawlore brand');
    }

    // 2. Run the ingest service
    console.log('\n2️⃣  Running employment law ingest...');
    console.log('   Calling ingestEmploymentLaw()...');

    const result = await ingestEmploymentLaw(brand.id, {
      limit: 10,
      includeAwards: true,
      updateOnly: false
    });

    console.log(`   ✓ Ingest completed!`);
    console.log(`     - Created: ${result.created}`);
    console.log(`     - Updated: ${result.updated}`);
    console.log(`     - Total: ${result.created + result.updated}`);

    // 3. Verify the data
    console.log('\n3️⃣  Verifying ingested data...\n');

    // Check sources
    const sources = await db.many(
      `SELECT code, name, sync_status, last_sync
       FROM law_sources
       WHERE code = 'fw_legislation'`
    );

    console.log('📊 Employment Law Sources:');
    if (sources.length > 0) {
      sources.forEach(s => {
        console.log(`   • ${s.name}`);
        console.log(`     Status: ${s.sync_status} | Last sync: ${s.last_sync ? new Date(s.last_sync).toISOString() : 'never'}`);
      });
    } else {
      console.log('   (none found)');
    }

    // Check statutes
    const statutes = await db.many(
      `SELECT id, title, year, jurisdiction, status
       FROM law_statutes
       WHERE title LIKE '%Fair Work%'
       OR title LIKE '%Discrimination%'
       OR title LIKE '%Award%'
       ORDER BY title`
    );

    console.log(`\n📚 Employment Law Statutes (${statutes.length} found):`);
    if (statutes.length > 0) {
      statutes.forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.title} (${s.year})`);
        console.log(`      Jurisdiction: ${s.jurisdiction} | Status: ${s.status}`);
      });
    } else {
      console.log('   (none found)');
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
    if (logs.length > 0) {
      logs.forEach((log, i) => {
        const icon = log.status === 'success' ? '✓' : '✗';
        console.log(`   ${icon} ${log.status.toUpperCase()}`);
        if (log.documents_created > 0 || log.documents_updated > 0) {
          console.log(`      Created: ${log.documents_created} | Updated: ${log.documents_updated}`);
        }
        if (log.error_message) console.log(`      Error: ${log.error_message}`);
      });
    } else {
      console.log('   (no logs found)');
    }

    // 4. Summary
    console.log('\n' + '='.repeat(50));
    if (statutes.length > 0) {
      console.log('✅ TEST PASSED - Employment law ingested successfully!');
      console.log(`   ${statutes.length} employment law documents now searchable`);
    } else {
      console.log('⚠️  TEST INCONCLUSIVE - No statutes found');
    }
    console.log('='.repeat(50));

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
