/**
 * Law Embeddings Service
 *
 * Generates semantic embeddings for law documents using OpenAI's embedding API
 * and stores them in PostgreSQL with pgvector for semantic search.
 */

import OpenAI from 'openai';
import db from '../db.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;
const BATCH_SIZE = 10; // Batch embeddings to avoid rate limits
const REQUEST_DELAY = 500; // ms between batches

/**
 * Generate embedding for text using OpenAI API
 * @param {string} text - Text to embed
 * @returns {Promise<{embedding: Array, tokens: number, cost: number}>}
 */
async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000), // Limit to 8K chars to avoid token limits
      encoding_format: 'float'
    });

    const embedding = response.data[0].embedding;
    const inputTokens = response.usage.prompt_tokens;

    // Calculate cost: text-embedding-3-small is $0.02 per 1M tokens
    const cost = (inputTokens / 1000000) * 0.02;

    return {
      embedding,
      tokens: inputTokens,
      cost
    };
  } catch (error) {
    console.error('Embedding generation error:', error);
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}

/**
 * Generate embeddings for all employment law statutes
 * @param {string} brandId - Brand ID
 * @param {Object} options - Options
 * @returns {Promise<{embedded: number, skipped: number, totalCost: number}>}
 */
export async function embedEmploymentStatutes(brandId, options = {}) {
  const { forceRefresh = false } = options;

  console.log('\n📊 Starting statute embedding generation...');

  try {
    // Get all statutes that need embeddings
    let statutes = await db.many(
      `SELECT id, title, short_title, content FROM law_statutes
       WHERE brand_id = $1
       ${!forceRefresh ? 'AND embedding IS NULL' : ''}
       ORDER BY created_at DESC`,
      [brandId]
    );

    if (statutes.length === 0) {
      console.log('✓ All statutes already embedded');
      return { embedded: 0, skipped: 0, totalCost: 0 };
    }

    console.log(`📝 Found ${statutes.length} statutes to embed`);

    let embedded = 0;
    let skipped = 0;
    let totalCost = 0;

    // Process in batches
    for (let i = 0; i < statutes.length; i += BATCH_SIZE) {
      const batch = statutes.slice(i, i + BATCH_SIZE);

      // Generate embeddings for batch
      const results = await Promise.all(
        batch.map(statute =>
          (async () => {
            try {
              const text = `${statute.title}. ${statute.short_title || ''}. ${statute.content}`;
              const { embedding, tokens, cost } = await generateEmbedding(text);

              // Store embedding
              await db.query(
                `UPDATE law_statutes
                 SET embedding = $1, embedding_model = $2, embedding_created_at = NOW()
                 WHERE id = $3`,
                [JSON.stringify(embedding), EMBEDDING_MODEL, statute.id]
              );

              // Log embedding metadata
              await db.query(
                `INSERT INTO law_embedding_metadata
                 (brand_id, entity_type, entity_id, model, tokens_used, cost_usd)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [brandId, 'statute', statute.id, EMBEDDING_MODEL, tokens, cost]
              );

              totalCost += cost;
              embedded++;
              console.log(`  ✓ ${statute.title} (${tokens} tokens)`);

              return true;
            } catch (error) {
              console.error(`  ✗ ${statute.title}: ${error.message}`);
              skipped++;
              return false;
            }
          })()
        )
      );

      // Delay between batches to respect rate limits
      if (i + BATCH_SIZE < statutes.length) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      }
    }

    console.log(`\n✅ Statute embedding complete!`);
    console.log(`   Embedded: ${embedded}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Cost: $${totalCost.toFixed(4)}`);

    return { embedded, skipped, totalCost };
  } catch (error) {
    console.error('Statute embedding error:', error);
    throw error;
  }
}

/**
 * Generate embeddings for all employment law cases
 * @param {string} brandId - Brand ID
 * @param {Object} options - Options
 * @returns {Promise<{embedded: number, skipped: number, totalCost: number}>}
 */
export async function embedEmploymentCases(brandId, options = {}) {
  const { forceRefresh = false } = options;

  console.log('\n📊 Starting case embedding generation...');

  try {
    // Get all cases that need embeddings
    let cases = await db.many(
      `SELECT id, title, citation, content FROM law_cases
       WHERE brand_id = $1
       ${!forceRefresh ? 'AND embedding IS NULL' : ''}
       ORDER BY created_at DESC`,
      [brandId]
    );

    if (cases.length === 0) {
      console.log('✓ All cases already embedded');
      return { embedded: 0, skipped: 0, totalCost: 0 };
    }

    console.log(`📝 Found ${cases.length} cases to embed`);

    let embedded = 0;
    let skipped = 0;
    let totalCost = 0;

    // Process in batches
    for (let i = 0; i < cases.length; i += BATCH_SIZE) {
      const batch = cases.slice(i, i + BATCH_SIZE);

      // Generate embeddings for batch
      const results = await Promise.all(
        batch.map(caseRecord =>
          (async () => {
            try {
              const text = `${caseRecord.title}. ${caseRecord.citation}. ${caseRecord.content}`;
              const { embedding, tokens, cost } = await generateEmbedding(text);

              // Store embedding
              await db.query(
                `UPDATE law_cases
                 SET embedding = $1, embedding_model = $2, embedding_created_at = NOW()
                 WHERE id = $3`,
                [JSON.stringify(embedding), EMBEDDING_MODEL, caseRecord.id]
              );

              // Log embedding metadata
              await db.query(
                `INSERT INTO law_embedding_metadata
                 (brand_id, entity_type, entity_id, model, tokens_used, cost_usd)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [brandId, 'case', caseRecord.id, EMBEDDING_MODEL, tokens, cost]
              );

              totalCost += cost;
              embedded++;
              console.log(`  ✓ ${caseRecord.citation} - ${caseRecord.title.substring(0, 50)}...`);

              return true;
            } catch (error) {
              console.error(`  ✗ ${caseRecord.citation}: ${error.message}`);
              skipped++;
              return false;
            }
          })()
        )
      );

      // Delay between batches
      if (i + BATCH_SIZE < cases.length) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      }
    }

    console.log(`\n✅ Case embedding complete!`);
    console.log(`   Embedded: ${embedded}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Cost: $${totalCost.toFixed(4)}`);

    return { embedded, skipped, totalCost };
  } catch (error) {
    console.error('Case embedding error:', error);
    throw error;
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Array} a - Vector a
 * @param {Array} b - Vector b
 * @returns {number} - Cosine similarity score (0-1)
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Semantic search across law statutes
 * @param {string} brandId - Brand ID
 * @param {string} query - Search query
 * @param {Object} options - Options
 * @returns {Promise<Array>} - Ranked results with similarity scores
 */
export async function semanticSearchStatutes(brandId, query, options = {}) {
  const { limit = 10, minSimilarity = 0.5 } = options;

  try {
    // Generate embedding for query
    const { embedding: queryEmbedding } = await generateEmbedding(query);

    // Fetch all embedded statutes
    const statutes = await db.many(
      `SELECT id, title, short_title, jurisdiction, status, year, embedding
       FROM law_statutes
       WHERE brand_id = $1 AND embedding IS NOT NULL`,
      [brandId]
    );

    // Calculate similarity scores in application layer
    const results = statutes
      .map(statute => {
        let docEmbedding = statute.embedding;
        if (typeof docEmbedding === 'string') {
          docEmbedding = JSON.parse(docEmbedding);
        }

        const score = cosineSimilarity(queryEmbedding, docEmbedding);
        return {
          id: statute.id,
          title: statute.title,
          short_title: statute.short_title,
          jurisdiction: statute.jurisdiction,
          status: statute.status,
          year: statute.year,
          similarity_score: score
        };
      })
      .filter(r => r.similarity_score >= minSimilarity)
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, limit);

    return results;
  } catch (error) {
    console.error('Semantic search error:', error);
    throw new Error(`Semantic search failed: ${error.message}`);
  }
}

/**
 * Semantic search across law cases
 * @param {string} brandId - Brand ID
 * @param {string} query - Search query
 * @param {Object} options - Options
 * @returns {Promise<Array>} - Ranked results with similarity scores
 */
export async function semanticSearchCases(brandId, query, options = {}) {
  const { limit = 10, minSimilarity = 0.5 } = options;

  try {
    // Generate embedding for query
    const { embedding: queryEmbedding } = await generateEmbedding(query);

    // Fetch all embedded cases
    const cases = await db.many(
      `SELECT id, title, citation, court, year, jurisdiction, embedding
       FROM law_cases
       WHERE brand_id = $1 AND embedding IS NOT NULL`,
      [brandId]
    );

    // Calculate similarity scores in application layer
    const results = cases
      .map(caseRecord => {
        let docEmbedding = caseRecord.embedding;
        if (typeof docEmbedding === 'string') {
          docEmbedding = JSON.parse(docEmbedding);
        }

        const score = cosineSimilarity(queryEmbedding, docEmbedding);
        return {
          id: caseRecord.id,
          title: caseRecord.title,
          citation: caseRecord.citation,
          court: caseRecord.court,
          year: caseRecord.year,
          jurisdiction: caseRecord.jurisdiction,
          similarity_score: score
        };
      })
      .filter(r => r.similarity_score >= minSimilarity)
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, limit);

    return results;
  } catch (error) {
    console.error('Semantic search error:', error);
    throw new Error(`Semantic search failed: ${error.message}`);
  }
}

/**
 * Combined semantic search across both statutes and cases
 * @param {string} brandId - Brand ID
 * @param {string} query - Search query
 * @param {Object} options - Options
 * @returns {Promise<Array>} - Combined results from both tables
 */
export async function semanticSearchAll(brandId, query, options = {}) {
  const { limit = 20, minSimilarity = 0.5 } = options;

  try {
    // Generate embedding once for query
    const { embedding: queryEmbedding } = await generateEmbedding(query);

    // Fetch all embedded statutes and cases concurrently
    const [statutes, cases] = await Promise.all([
      db.many(
        `SELECT 'statute' as type, id, title as name, short_title, jurisdiction, status, year, embedding
         FROM law_statutes
         WHERE brand_id = $1 AND embedding IS NOT NULL`,
        [brandId]
      ),
      db.many(
        `SELECT 'case' as type, id, title as name, citation, court, year, jurisdiction, embedding
         FROM law_cases
         WHERE brand_id = $1 AND embedding IS NOT NULL`,
        [brandId]
      )
    ]);

    // Calculate similarity scores for all documents
    const combinedResults = [];

    statutes.forEach(statute => {
      let docEmbedding = statute.embedding;
      if (typeof docEmbedding === 'string') {
        docEmbedding = JSON.parse(docEmbedding);
      }

      const score = cosineSimilarity(queryEmbedding, docEmbedding);
      if (score >= minSimilarity) {
        combinedResults.push({
          type: 'statute',
          id: statute.id,
          name: statute.name,
          short_title: statute.short_title,
          jurisdiction: statute.jurisdiction,
          status: statute.status,
          year: statute.year,
          score
        });
      }
    });

    cases.forEach(caseRecord => {
      let docEmbedding = caseRecord.embedding;
      if (typeof docEmbedding === 'string') {
        docEmbedding = JSON.parse(docEmbedding);
      }

      const score = cosineSimilarity(queryEmbedding, docEmbedding);
      if (score >= minSimilarity) {
        combinedResults.push({
          type: 'case',
          id: caseRecord.id,
          name: caseRecord.name,
          citation: caseRecord.citation,
          court: caseRecord.court,
          year: caseRecord.year,
          jurisdiction: caseRecord.jurisdiction,
          score
        });
      }
    });

    // Sort by score and limit results
    const combined = combinedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return combined;
  } catch (error) {
    console.error('Combined semantic search error:', error);
    throw new Error(`Semantic search failed: ${error.message}`);
  }
}

/**
 * Get embedding statistics for a brand
 * @param {string} brandId - Brand ID
 * @returns {Promise<Object>} - Statistics
 */
export async function getEmbeddingStats(brandId) {
  try {
    const stats = await db.one(
      `SELECT
        COUNT(CASE WHEN entity_type = 'statute' THEN 1 END) as statute_count,
        COUNT(CASE WHEN entity_type = 'case' THEN 1 END) as case_count,
        SUM(tokens_used) as total_tokens,
        SUM(cost_usd) as total_cost,
        MAX(embedded_at) as last_embedded
       FROM law_embedding_metadata
       WHERE brand_id = $1`,
      [brandId]
    );

    const total = await db.one(
      `SELECT
        (SELECT COUNT(*) FROM law_statutes WHERE brand_id = $1 AND embedding IS NOT NULL) as embedded_statutes,
        (SELECT COUNT(*) FROM law_statutes WHERE brand_id = $1) as total_statutes,
        (SELECT COUNT(*) FROM law_cases WHERE brand_id = $1 AND embedding IS NOT NULL) as embedded_cases,
        (SELECT COUNT(*) FROM law_cases WHERE brand_id = $1) as total_cases`,
      [brandId]
    );

    return {
      metadata: stats,
      progress: {
        statutes: `${total.embedded_statutes}/${total.total_statutes}`,
        cases: `${total.embedded_cases}/${total.total_cases}`,
        percentComplete: total.total_statutes + total.total_cases > 0
          ? Math.round(
              ((total.embedded_statutes + total.embedded_cases) /
               (total.total_statutes + total.total_cases)) * 100
            )
          : 0
      }
    };
  } catch (error) {
    console.error('Stats retrieval error:', error);
    throw error;
  }
}
