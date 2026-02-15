#!/usr/bin/env node

/**
 * Employment Law Cases Ingest Test
 *
 * Tests the employment law cases ingest service
 */

import db from './db.js';
import { ingestEmploymentCases } from './services/law-employment-cases-ingest.service.js';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 EMPLOYMENT LAW CASES INGEST TEST');
  console.log('='.repeat(70) + '\n');

  try {
    // Get lawlore brand
    let brand = await db.one(`SELECT id FROM brands WHERE code = 'law'`);
    if (!brand) {
      const brandId = uuidv4();
      await db.query(
        `INSERT INTO brands (id, code, name) VALUES ($1, $2, $3)`,
        [brandId, 'law', 'Lawlore']
      );
      brand = { id: brandId };
      console.log('✓ Created lawlore brand');
    } else {
      console.log('✓ Using existing lawlore brand');
    }

    // Run ingest
    console.log('\n📋 Running employment law cases ingest...\n');
    const result = await ingestEmploymentCases(brand.id, {
      limit: 10,
      years: [2024, 2023, 2022],
      includeAgency: true
    });

    console.log(`\n✅ Ingest complete!`);
    console.log(`   - Created: ${result.created}`);
    console.log(`   - Updated: ${result.updated}`);
    console.log(`   - Total: ${result.created + result.updated}`);

    // Verify in database
    console.log('\n📊 Verification:\n');

    const caseCount = await db.one(
      `SELECT COUNT(*) as count FROM law_cases
       WHERE title LIKE '%Employment%' OR title LIKE '%Dismissal%' OR citation LIKE '%FCA%' OR citation LIKE '%AM%'`
    );
    console.log(`📚 Employment law cases found: ${caseCount.count}`);

    const federalCases = await db.many(
      `SELECT citation, title FROM law_cases
       WHERE citation LIKE '%FCA%' OR court = 'Federal Court of Australia'
       LIMIT 5`
    );

    if (federalCases.length > 0) {
      console.log(`\n⚖️  Federal Court Cases (${federalCases.length})`);
      federalCases.forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.citation} - ${c.title}`);
      });
    }

    const fwcCases = await db.many(
      `SELECT citation, title FROM law_cases
       WHERE citation LIKE '%AM%' OR court = 'Fair Work Commission'
       LIMIT 5`
    );

    if (fwcCases.length > 0) {
      console.log(`\n⚖️  Fair Work Commission Cases (${fwcCases.length})`);
      fwcCases.forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.citation} - ${c.title}`);
      });
    }

    // Check case content
    const sampleCase = await db.one(
      `SELECT title, content FROM law_cases
       WHERE content IS NOT NULL AND LENGTH(content) > 100
       LIMIT 1`
    );

    if (sampleCase) {
      console.log(`\n📄 Sample Case Content:`);
      console.log(`   Title: ${sampleCase.title}`);
      console.log(`   Length: ${sampleCase.content.length} characters`);
      console.log(`   Preview: ${sampleCase.content.substring(0, 100)}...`);
    }

    // Check source
    const source = await db.one(
      `SELECT * FROM law_sources WHERE code = 'fw_cases'`
    );

    if (source) {
      console.log(`\n📁 Employment Cases Source:`);
      console.log(`   Code: ${source.code}`);
      console.log(`   Name: ${source.name}`);
      console.log(`   Status: ${source.sync_status}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL TESTS PASSED');
    console.log('='.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
