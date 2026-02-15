import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { detectAndLinkCitations } from './law-citations.service.js';
import { getSourceId, logIngestionStart, logIngestionSuccess, logIngestionFailure } from './law-ingest-helpers.js';

/**
 * Ingest Commonwealth legislation from legislation.gov.au
 * Phase 1: Placeholder implementation (to be replaced with legaldata library)
 * Phase 2: Full implementation with legaldata library
 */
export async function ingestCommonwealthLegislation(brandId) {
  const sourceId = await getSourceId(brandId, 'cth_acts');
  if (!sourceId) {
    throw new Error('Commonwealth legislation source not found');
  }

  const logId = uuidv4();
  const startTime = Date.now();

  try {
    // Log ingestion start
    await logIngestionStart(logId, brandId, sourceId);

    // Phase 1: No actual ingestion yet
    // Phase 2: Use legaldata library to download legislation
    // const legislation = await legaldata.fetchCommonwealthActs();

    let created = 0;
    let updated = 0;

    // For now, just log placeholder
    console.log('[INGEST] Commonwealth legislation: Phase 1 (placeholder)');

    await logIngestionSuccess(logId, created, updated, startTime, brandId, sourceId);
    return { created, updated };
  } catch (error) {
    console.error('[INGEST ERROR] Commonwealth legislation:', error);
    await logIngestionFailure(logId, error.message, startTime, brandId, sourceId);
    throw error;
  }
}

/**
 * Ingest High Court of Australia cases from AustLII
 * Phase 1: Placeholder implementation (to be replaced with AustLII scraper)
 * Phase 2: Full implementation with respect for rate limits
 */
export async function ingestHighCourtCases(brandId) {
  const sourceId = await getSourceId(brandId, 'hca_cases');
  if (!sourceId) {
    throw new Error('High Court of Australia source not found');
  }

  const logId = uuidv4();
  const startTime = Date.now();

  try {
    // Log ingestion start
    await logIngestionStart(logId, brandId, sourceId);

    // Phase 1: No actual ingestion yet
    // Phase 2: Implement AustLII web scraper
    // const cases = await scrapeAustLII('au/cases/cth/HCA/');

    let created = 0;
    let updated = 0;

    // For now, just log placeholder
    console.log('[INGEST] High Court cases: Phase 1 (placeholder)');

    await logIngestionSuccess(logId, created, updated, startTime, brandId, sourceId);
    return { created, updated };
  } catch (error) {
    console.error('[INGEST ERROR] High Court cases:', error);
    await logIngestionFailure(logId, error.message, startTime, brandId, sourceId);
    throw error;
  }
}

/**
 * Upsert a statute into the database
 * @internal used by ingestion services
 */
export async function upsertStatute(brandId, sourceId, statute) {
  const statuteId = uuidv4();

  const result = await db.one(
    `INSERT INTO law_statutes
      (id, brand_id, source_id, title, short_title, content, jurisdiction, status, year, version_no, effective_date, url, sections)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (brand_id, source_id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       version_no = version_no + 1,
       updated_at = NOW()
     RETURNING id, title`,
    [
      statuteId,
      brandId,
      sourceId,
      statute.title,
      statute.shortTitle,
      statute.content,
      statute.jurisdiction,
      statute.status || 'current',
      statute.year,
      1,
      statute.effectiveDate,
      statute.url,
      JSON.stringify(statute.sections || [])
    ]
  );

  // Detect and link citations in the statute
  await detectAndLinkCitations(brandId, statute.content, result.id, 'statute');

  return result;
}

/**
 * Upsert a case into the database
 * @internal used by ingestion services
 */
export async function upsertCase(brandId, sourceId, caseData) {
  const caseId = uuidv4();

  const result = await db.one(
    `INSERT INTO law_cases
      (id, brand_id, source_id, title, citation, content, court, judges, year, headnotes, holding, jurisdiction, url, citations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (brand_id, citation) DO UPDATE SET
       content = EXCLUDED.content,
       title = EXCLUDED.title,
       updated_at = NOW()
     RETURNING id, citation`,
    [
      caseId,
      brandId,
      sourceId,
      caseData.title,
      caseData.citation,
      caseData.content,
      caseData.court,
      JSON.stringify(caseData.judges || []),
      caseData.year,
      caseData.headnotes,
      caseData.holding,
      caseData.jurisdiction,
      caseData.url,
      JSON.stringify(caseData.citations || [])
    ]
  );

  // Detect and link citations in the case
  await detectAndLinkCitations(brandId, caseData.content, result.id, 'case');

  return result;
}

