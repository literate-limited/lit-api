/**
 * Shared helpers for law ingestion services
 * Used by: law-ingest.service.js, law-employment-ingest.service.js,
 *          law-commonwealth-ingest.service.js, law-employment-cases-ingest.service.js,
 *          law-hca-ingest.service.js
 */

import db from '../db.js';

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get law source ID by brand and source code
 */
export async function getSourceId(brandId, code) {
  const source = await db.one(
    `SELECT id FROM law_sources WHERE brand_id = $1 AND code = $2`,
    [brandId, code]
  );
  return source?.id;
}

/**
 * Log ingestion start
 */
export async function logIngestionStart(logId, brandId, sourceId) {
  await db.query(
    `INSERT INTO law_ingestion_log (id, brand_id, source_id, status, started_at)
     VALUES ($1, $2, $3, 'started', NOW())`,
    [logId, brandId, sourceId]
  );
}

/**
 * Log ingestion success with document counts and duration
 */
export async function logIngestionSuccess(logId, docsCreated, docsUpdated, startTime, brandId, sourceId) {
  const durationSeconds = Math.round((Date.now() - startTime) / 1000);

  await db.query(
    `UPDATE law_ingestion_log
     SET status = 'success',
         documents_created = $1,
         documents_updated = $2,
         completed_at = NOW(),
         duration_seconds = $3
     WHERE id = $4`,
    [docsCreated, docsUpdated, durationSeconds, logId]
  );

  // Update source's last_sync timestamp
  await db.query(
    `UPDATE law_sources
     SET last_sync = NOW(), sync_status = 'success'
     WHERE id = $1`,
    [sourceId]
  );

  console.log(`[INGEST SUCCESS] logId=${logId}, created=${docsCreated}, updated=${docsUpdated}, duration=${durationSeconds}s`);
}

/**
 * Log ingestion failure with error message and duration
 */
export async function logIngestionFailure(logId, errorMessage, startTime, brandId, sourceId) {
  const durationSeconds = Math.round((Date.now() - startTime) / 1000);

  await db.query(
    `UPDATE law_ingestion_log
     SET status = 'failed',
         error_message = $1,
         completed_at = NOW(),
         duration_seconds = $2
     WHERE id = $3`,
    [errorMessage, durationSeconds, logId]
  );

  // Update source's sync_status
  await db.query(
    `UPDATE law_sources
     SET sync_status = 'failed'
     WHERE id = $1`,
    [sourceId]
  );

  console.error(`[INGEST FAILURE] logId=${logId}, error=${errorMessage}`);
}
