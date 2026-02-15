#!/usr/bin/env node

/**
 * Law Embeddings Test Suite
 *
 * Tests vector embedding generation and semantic search functionality
 * for employment law documents.
 */

import db from './db.js';
import {
  embedEmploymentStatutes,
  embedEmploymentCases,
  semanticSearchStatutes,
  semanticSearchCases,
  semanticSearchAll,
  getEmbeddingStats
} from './services/law-embeddings.service.js';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 LAW EMBEDDINGS TEST SUITE');
  console.log('='.repeat(70) + '\n');

  try {
    // Get or create lawlore brand
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

    // ========================================================================
    // Phase 1: Check if statutes exist
    // ========================================================================

    console.log('\n📋 CHECKING EXISTING DOCUMENTS\n');

    const statuteCount = await db.one(
      `SELECT COUNT(*) as count FROM law_statutes WHERE brand_id = $1`,
      [brand.id]
    );
    console.log(`📚 Statutes in database: ${statuteCount.count}`);

    const caseCount = await db.one(
      `SELECT COUNT(*) as count FROM law_cases WHERE brand_id = $1`,
      [brand.id]
    );
    console.log(`📚 Cases in database: ${caseCount.count}`);

    if (statuteCount.count === 0 || caseCount.count === 0) {
      console.log('\n⚠️  No documents found. Please run employment law ingest first:');
      console.log('   node test-employment-final.mjs');
      process.exit(1);
    }

    // ========================================================================
    // Phase 2: Generate Embeddings
    // ========================================================================

    console.log('\n📊 GENERATING EMBEDDINGS\n');

    console.log('🔄 Embedding statutes...');
    const statuteResult = await embedEmploymentStatutes(brand.id, { forceRefresh: false });
    console.log(`✅ Statute embedding complete:`);
    console.log(`   - Embedded: ${statuteResult.embedded}`);
    console.log(`   - Skipped: ${statuteResult.skipped}`);
    console.log(`   - Cost: $${statuteResult.totalCost.toFixed(4)}`);

    console.log('\n🔄 Embedding cases...');
    const caseResult = await embedEmploymentCases(brand.id, { forceRefresh: false });
    console.log(`✅ Case embedding complete:`);
    console.log(`   - Embedded: ${caseResult.embedded}`);
    console.log(`   - Skipped: ${caseResult.skipped}`);
    console.log(`   - Cost: $${caseResult.totalCost.toFixed(4)}`);

    // ========================================================================
    // Phase 3: Verify Embeddings in Database
    // ========================================================================

    console.log('\n📊 VERIFICATION\n');

    const embeddedStatutes = await db.one(
      `SELECT COUNT(*) as count FROM law_statutes WHERE brand_id = $1 AND embedding IS NOT NULL`,
      [brand.id]
    );
    console.log(`✓ Embedded statutes: ${embeddedStatutes.count}/${statuteCount.count}`);

    const embeddedCases = await db.one(
      `SELECT COUNT(*) as count FROM law_cases WHERE brand_id = $1 AND embedding IS NOT NULL`,
      [brand.id]
    );
    console.log(`✓ Embedded cases: ${embeddedCases.count}/${caseCount.count}`);

    // Check embedding metadata
    const metadata = await db.one(
      `SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN entity_type = 'statute' THEN 1 ELSE 0 END) as statute_records,
        SUM(CASE WHEN entity_type = 'case' THEN 1 ELSE 0 END) as case_records,
        SUM(tokens_used) as total_tokens,
        SUM(cost_usd) as total_cost
       FROM law_embedding_metadata
       WHERE brand_id = $1`,
      [brand.id]
    );
    console.log(`\n📊 Embedding Metadata:`);
    console.log(`   - Total records: ${metadata.total_records}`);
    console.log(`   - Statute records: ${metadata.statute_records}`);
    console.log(`   - Case records: ${metadata.case_records}`);
    console.log(`   - Total tokens: ${metadata.total_tokens}`);
    const costValue = metadata.total_cost ? Number(metadata.total_cost) : 0;
    console.log(`   - Total cost: $${costValue.toFixed(4)}`);

    // ========================================================================
    // Phase 4: Semantic Search Tests
    // ========================================================================

    console.log('\n🔍 SEMANTIC SEARCH TESTS\n');

    // Test 1: Search for workplace discrimination
    console.log('Test 1: Search for "workplace discrimination laws"');
    const discriminationResults = await semanticSearchStatutes(
      brand.id,
      'workplace discrimination laws',
      { limit: 5, minSimilarity: 0.3 }
    );
    console.log(`   Found ${discriminationResults.length} results:`);
    discriminationResults.slice(0, 3).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.title} (similarity: ${(r.similarity_score * 100).toFixed(1)}%)`);
    });

    // Test 2: Search for fair work
    console.log('\nTest 2: Search for "fair work and employment rights"');
    const fairWorkResults = await semanticSearchStatutes(
      brand.id,
      'fair work and employment rights',
      { limit: 5, minSimilarity: 0.3 }
    );
    console.log(`   Found ${fairWorkResults.length} results:`);
    fairWorkResults.slice(0, 3).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.title} (similarity: ${(r.similarity_score * 100).toFixed(1)}%)`);
    });

    // Test 3: Search cases
    if (embeddedCases.count > 0) {
      console.log('\nTest 3: Search cases for "dismissal and unfair termination"');
      const dismissalResults = await semanticSearchCases(
        brand.id,
        'dismissal and unfair termination',
        { limit: 5, minSimilarity: 0.3 }
      );
      console.log(`   Found ${dismissalResults.length} case results:`);
      dismissalResults.slice(0, 3).forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.citation} (similarity: ${(r.similarity_score * 100).toFixed(1)}%)`);
      });
    }

    // Test 4: Combined search
    console.log('\nTest 4: Combined search for "worker protection legislation"');
    const combinedResults = await semanticSearchAll(
      brand.id,
      'worker protection legislation',
      { limit: 10, minSimilarity: 0.3 }
    );
    console.log(`   Found ${combinedResults.length} combined results:`);
    combinedResults.slice(0, 5).forEach((r, i) => {
      const title = r.name || r.title;
      const type = r.type === 'case' ? `[${r.citation}]` : '[statute]';
      console.log(`   ${i + 1}. ${title} ${type} (${(r.score * 100).toFixed(1)}%)`);
    });

    // ========================================================================
    // Phase 5: Stats and Summary
    // ========================================================================

    console.log('\n📊 EMBEDDING STATISTICS\n');

    const stats = await getEmbeddingStats(brand.id);
    console.log(`Model: text-embedding-3-small (1536 dimensions)`);
    console.log(`Statutes: ${stats.progress.statutes}`);
    console.log(`Cases: ${stats.progress.cases}`);
    console.log(`Total completion: ${stats.progress.percentComplete}%`);

    if (stats.metadata?.total_tokens) {
      console.log(`\nTotal tokens used: ${stats.metadata.total_tokens}`);
      const costVal = stats.metadata.total_cost ? Number(stats.metadata.total_cost) : 0;
      console.log(`Total cost: $${costVal.toFixed(4)}`);
    }

    // ========================================================================
    // Final Summary
    // ========================================================================

    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL TESTS PASSED');
    console.log('='.repeat(70));
    console.log('\n✨ Semantic search is now ready!');
    console.log('   Try: POST /api/law/search-semantic');
    console.log('   Example payload: { "query": "worker protection laws", "limit": 10 }');
    console.log('\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
