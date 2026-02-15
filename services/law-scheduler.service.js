/**
 * Law Data Synchronization Scheduler
 * Schedules daily ingestion of legal data from various sources
 *
 * In production, this would use a job queue like Bull or node-cron
 */

import db from '../db.js';
import { ingestCommonwealthLegislation } from './law-commonwealth-ingest.service.js';
import { ingestHighCourtCases } from './law-hca-ingest.service.js';

/**
 * Schedule daily law data sync
 * Runs at 2:00 AM UTC (off-peak hours)
 */
export async function scheduleDailySync(brandId) {
  console.log('[SCHEDULER] Daily law data sync scheduled for 02:00 UTC');

  // In production, you would use:
  // const cron = require('node-cron');
  // cron.schedule('0 2 * * *', () => {
  //   runDailySync(brandId).catch(err => console.error('[SCHEDULER] Sync failed:', err));
  // });

  return {
    scheduled: true,
    cronPattern: '0 2 * * *',
    description: 'Daily sync at 2:00 AM UTC',
    message: 'To enable in production, uncomment node-cron scheduling in this service'
  };
}

/**
 * Run the daily synchronization job
 */
export async function runDailySync(brandId) {
  console.log('[SCHEDULER] Starting daily law data sync...');
  const startTime = Date.now();

  try {
    // Get law brand if not provided
    if (!brandId) {
      const brand = await db.one(
        `SELECT id FROM brands WHERE code = 'law'`
      );
      if (!brand) {
        throw new Error('Law brand not found');
      }
      brandId = brand.id;
    }

    console.log('[SCHEDULER] Syncing Commonwealth legislation...');
    const cthResult = await ingestCommonwealthLegislation(brandId, {
      limit: 100,
      startYear: 1990,
      updateOnly: true
    });

    console.log('[SCHEDULER] Syncing High Court cases...');
    const hcaResult = await ingestHighCourtCases(brandId, {
      limit: 50,
      years: [2023, 2022, 2021, 2020],
      updateOnly: true
    });

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('[SCHEDULER] Daily sync complete:');
    console.log(`  - Commonwealth: ${cthResult.created} created, ${cthResult.updated} updated`);
    console.log(`  - High Court: ${hcaResult.created} created, ${hcaResult.updated} updated`);
    console.log(`  - Total time: ${duration}s`);

    // Log to database
    await db.query(
      `INSERT INTO law_ingestion_log
        (id, brand_id, source_id, status, documents_created, documents_updated, completed_at, duration_seconds)
       SELECT
        gen_random_uuid(),
        $1,
        id,
        'success',
        CASE code WHEN 'cth_acts' THEN $2 WHEN 'hca_cases' THEN $4 ELSE 0 END,
        CASE code WHEN 'cth_acts' THEN $3 WHEN 'hca_cases' THEN $5 ELSE 0 END,
        NOW(),
        $6
       FROM law_sources
       WHERE brand_id = $1 AND code IN ('cth_acts', 'hca_cases')`,
      [brandId, cthResult.created, cthResult.updated, hcaResult.created, hcaResult.updated, Math.round(duration)]
    );

    return {
      success: true,
      duration,
      commonwealth: cthResult,
      highCourt: hcaResult,
      totalCreated: cthResult.created + hcaResult.created,
      totalUpdated: cthResult.updated + hcaResult.updated
    };
  } catch (error) {
    console.error('[SCHEDULER] Sync failed:', error);

    // Log failure
    await db.query(
      `INSERT INTO law_ingestion_log (id, brand_id, source_id, status, error_message, completed_at, duration_seconds)
       SELECT
        gen_random_uuid(),
        $1,
        id,
        'failed',
        $2,
        NOW(),
        $3
       FROM law_sources
       WHERE brand_id = $1 AND code IN ('cth_acts', 'hca_cases')`,
      [brandId, error.message, Math.round((Date.now() - startTime) / 1000)]
    ).catch(e => console.error('[SCHEDULER] Failed to log error:', e));

    throw error;
  }
}

/**
 * Get sync schedule status
 */
export async function getSyncScheduleStatus(brandId) {
  try {
    const lastSyncs = await db.many(
      `SELECT
        ls.code,
        ls.name,
        ls.last_sync,
        ril.status,
        ril.documents_created,
        ril.documents_updated,
        ril.duration_seconds,
        ril.error_message
       FROM law_sources ls
       LEFT JOIN law_ingestion_log ril ON ls.id = ril.source_id
       WHERE ls.brand_id = $1
       ORDER BY ls.code, ril.completed_at DESC NULLS LAST`,
      [brandId]
    );

    const now = new Date();
    const scheduleStatus = {
      cronPattern: '0 2 * * *',
      nextRunTime: getNextRunTime(),
      lastRuns: lastSyncs.reduce((acc, sync) => {
        if (!acc[sync.code]) {
          acc[sync.code] = {
            name: sync.name,
            lastSync: sync.last_sync,
            lastStatus: sync.status,
            documentsCreated: sync.documents_created,
            documentsUpdated: sync.documents_updated,
            durationSeconds: sync.duration_seconds,
            errorMessage: sync.error_message
          };
        }
        return acc;
      }, {})
    };

    return scheduleStatus;
  } catch (error) {
    console.error('[SCHEDULER] Error getting schedule status:', error);
    return { error: error.message };
  }
}

/**
 * Calculate next run time (2:00 AM UTC)
 */
function getNextRunTime() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(2, 0, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

/**
 * Installation instructions for production
 */
export const INSTALLATION_INSTRUCTIONS = `
=== Setting up Daily Data Sync in Production ===

1. Install node-cron (or Bull for more robust scheduling):
   npm install node-cron

2. Add to your application startup (e.g., server.js):
   ======================================
   import cron from 'node-cron';
   import { runDailySync } from './services/law-scheduler.service.js';

   // Schedule daily sync at 2:00 AM UTC
   cron.schedule('0 2 * * *', async () => {
     try {
       console.log('[CRON] Starting daily law data sync...');
       const result = await runDailySync();
       console.log('[CRON] Sync completed:', result);
     } catch (error) {
       console.error('[CRON] Sync failed:', error);
       // Send alert/notification here
     }
   });
   ======================================

3. For more robust job queuing (Bull example):
   npm install bull redis

   const Queue = require('bull');
   const syncQueue = new Queue('law-sync', {
     redis: { host: process.env.REDIS_HOST, port: 6379 }
   });

   syncQueue.process(async (job) => {
     return await runDailySync(job.data.brandId);
   });

   // Schedule job
   syncQueue.add({ brandId }, { repeat: { cron: '0 2 * * *' } });

4. Monitor sync status:
   GET /api/law/sync-status

5. Manual sync trigger:
   POST /api/law/ingest/commonwealth
   POST /api/law/ingest/hca
`;
