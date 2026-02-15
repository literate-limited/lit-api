/**
 * Unified Progress Service
 *
 * Single source of truth for all student progress across apps (LIT, Law, Deb, TTV, etc.)
 * Apps call this service to record/update progress instead of maintaining separate tables
 */

import db from '../db.js';

/**
 * Record or update student progress
 * @param {Object} progressData - Progress data
 * @returns {Promise<Object>} - Updated progress record
 */
export async function recordProgress(progressData) {
  const {
    brandId,
    userId,
    classId = null,
    appCode,
    topicId,
    unitId,
    levelId,
    status = 'in_progress',
    score = null,
    timeSpentSeconds = 0,
    metadata = {}
  } = progressData;

  if (!brandId || !userId || !appCode || !topicId || !unitId) {
    throw new Error('Missing required fields: brandId, userId, appCode, topicId, unitId');
  }

  try {
    // Upsert progress record
    const progress = await db.one(
      `INSERT INTO unified_student_progress
        (brand_id, user_id, class_id, app_code, topic_id, unit_id, level_id,
         status, score, time_spent_seconds, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       ON CONFLICT (user_id, app_code, unit_id) DO UPDATE SET
         status = EXCLUDED.status,
         score = COALESCE(EXCLUDED.score, unified_student_progress.score),
         time_spent_seconds = unified_student_progress.time_spent_seconds + EXCLUDED.time_spent_seconds,
         metadata = EXCLUDED.metadata,
         last_attempted_at = NOW(),
         completed_at = CASE
           WHEN EXCLUDED.status = 'completed' THEN NOW()
           ELSE unified_student_progress.completed_at
         END,
         updated_at = NOW()
       RETURNING *`,
      [
        brandId, userId, classId, appCode, topicId, unitId, levelId,
        status, score, timeSpentSeconds, JSON.stringify(metadata)
      ]
    );

    // NEW: Track pathway step completion when content is completed
    if (status === 'completed') {
      try {
        await updatePathwayStepsForContent(brandId, userId, levelId, unitId, score, timeSpentSeconds);
      } catch (pathwayError) {
        console.error('Error updating pathway steps:', pathwayError);
        // Don't throw - pathway update shouldn't break progress recording
      }
    }

    return progress;
  } catch (error) {
    console.error('Progress recording error:', error);
    throw new Error(`Failed to record progress: ${error.message}`);
  }
}

/**
 * Update pathway steps when content is completed
 * Finds which pathway steps reference this content and marks them as completed
 * @private
 */
async function updatePathwayStepsForContent(brandId, userId, levelId, unitId, score, timeSpentSeconds) {
  // Find pathway steps that reference this content
  const pathwaySteps = await db.many(
    `SELECT ps.id, ps.pathway_id, spp.id as enrollment_id
     FROM pathway_steps ps
     JOIN student_pathway_progress spp ON ps.pathway_id = spp.pathway_id
     WHERE spp.user_id = $1 AND spp.brand_id = $2
       AND spp.status IN ('in_progress', 'not_started')
       AND (ps.level_id = $3 OR ps.unit_id = $4)`,
    [userId, brandId, levelId, unitId]
  );

  // Update each pathway step
  for (const step of pathwaySteps) {
    await db.query(
      `UPDATE student_step_progress
       SET status = 'completed', score = $1, time_spent_seconds = $2, completed_at = NOW(), updated_at = NOW()
       WHERE user_id = $3 AND pathway_id = $4 AND step_id = $5`,
      [score, timeSpentSeconds, userId, step.pathway_id, step.id]
    );
  }
}

/**
 * Get student's progress across all apps
 * @param {string} userId - Student user ID
 * @returns {Promise<Array>} - All progress records for student
 */
export async function getStudentProgress(userId) {
  try {
    const progress = await db.many(
      `SELECT
        id, brand_id, app_code, topic_id, unit_id, level_id,
        status, score, time_spent_seconds, attempts, completed_at,
        metadata, created_at, updated_at
       FROM unified_student_progress
       WHERE user_id = $1
       ORDER BY app_code, updated_at DESC`,
      [userId]
    );

    return progress;
  } catch (error) {
    console.error('Progress fetch error:', error);
    throw error;
  }
}

/**
 * Get student's progress in specific app
 * @param {string} userId - Student user ID
 * @param {string} appCode - App code ('law', 'lit', 'deb', etc.)
 * @returns {Promise<Array>} - Progress for that app
 */
export async function getStudentProgressByApp(userId, appCode) {
  try {
    const progress = await db.many(
      `SELECT
        id, app_code, topic_id, unit_id, level_id,
        status, score, time_spent_seconds, completed_at, metadata
       FROM unified_student_progress
       WHERE user_id = $1 AND app_code = $2
       ORDER BY created_at DESC`,
      [userId, appCode]
    );

    return progress;
  } catch (error) {
    console.error('App progress fetch error:', error);
    throw error;
  }
}

/**
 * Get class progress summary (for teacher dashboard)
 * @param {string} classId - Class ID
 * @returns {Promise<Object>} - Progress summary
 */
export async function getClassProgressSummary(classId) {
  try {
    const summary = await db.one(
      `SELECT
        COUNT(DISTINCT user_id) as student_count,
        COUNT(DISTINCT app_code) as apps_used,
        AVG(score) as average_score,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN status = 'struggling' THEN 1 END) as struggling_count
       FROM unified_student_progress
       WHERE class_id = $1`,
      [classId]
    );

    return summary;
  } catch (error) {
    console.error('Class summary error:', error);
    throw error;
  }
}

/**
 * Get per-app progress for a class
 * @param {string} classId - Class ID
 * @returns {Promise<Array>} - App usage summary
 */
export async function getClassProgressByApp(classId) {
  try {
    const appProgress = await db.many(
      `SELECT
        app_code,
        COUNT(DISTINCT user_id) as students_active,
        COUNT(*) as total_activities,
        AVG(score) as avg_score,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
       FROM unified_student_progress
       WHERE class_id = $1
       GROUP BY app_code
       ORDER BY app_code`,
      [classId]
    );

    return appProgress;
  } catch (error) {
    console.error('App progress summary error:', error);
    throw error;
  }
}

/**
 * Get student details for teacher dashboard
 * @param {string} classId - Class ID
 * @returns {Promise<Array>} - Student progress details
 */
export async function getStudentProgressDetails(classId) {
  try {
    const students = await db.many(
      `SELECT
        u.id, u.first_name, u.last_name, u.email,
        COUNT(DISTINCT p.app_code) as apps_started,
        COUNT(CASE WHEN p.status = 'completed' THEN 1 END) as units_completed,
        AVG(p.score) as average_score,
        MAX(p.updated_at) as last_activity
       FROM core_users u
       LEFT JOIN unified_student_progress p ON u.id = p.user_id
       WHERE u.id IN (
         SELECT student_id FROM enrollments WHERE class_id = $1
       )
       GROUP BY u.id, u.first_name, u.last_name, u.email
       ORDER BY u.last_name, u.first_name`,
      [classId]
    );

    return students;
  } catch (error) {
    console.error('Student details error:', error);
    throw error;
  }
}

/**
 * Create learning recommendation for student
 * @param {Object} recommendationData - Recommendation data
 * @returns {Promise<Object>} - Created recommendation
 */
export async function createRecommendation(recommendationData) {
  const {
    userId,
    appCode,
    unitId,
    topicId,
    reason,
    confidence = 0.8,
    metadata = {}
  } = recommendationData;

  if (!userId || !appCode || !unitId || !topicId || !reason) {
    throw new Error('Missing required fields for recommendation');
  }

  try {
    const recommendation = await db.one(
      `INSERT INTO learning_recommendations
        (user_id, app_code, unit_id, topic_id, reason, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, appCode, unitId, topicId, reason, confidence, JSON.stringify(metadata)]
    );

    return recommendation;
  } catch (error) {
    console.error('Recommendation creation error:', error);
    throw error;
  }
}

/**
 * Get active recommendations for student
 * @param {string} userId - Student user ID
 * @returns {Promise<Array>} - Active recommendations
 */
export async function getStudentRecommendations(userId) {
  try {
    const recommendations = await db.many(
      `SELECT
        id, app_code, unit_id, topic_id, reason, confidence,
        status, created_at
       FROM learning_recommendations
       WHERE user_id = $1 AND status IN ('pending', 'viewed')
         AND expires_at > NOW()
       ORDER BY confidence DESC, created_at DESC
       LIMIT 5`,
      [userId]
    );

    return recommendations;
  } catch (error) {
    console.error('Recommendations fetch error:', error);
    throw error;
  }
}

/**
 * Mark recommendation as viewed/started/dismissed
 * @param {string} recommendationId - Recommendation ID
 * @param {string} status - New status
 * @returns {Promise<Object>} - Updated recommendation
 */
export async function updateRecommendationStatus(recommendationId, status) {
  if (!['pending', 'viewed', 'started', 'dismissed'].includes(status)) {
    throw new Error('Invalid recommendation status');
  }

  try {
    const recommendation = await db.one(
      `UPDATE learning_recommendations
       SET status = $1,
           viewed_at = CASE WHEN $1 = 'viewed' THEN NOW() ELSE viewed_at END,
           dismissed_at = CASE WHEN $1 = 'dismissed' THEN NOW() ELSE dismissed_at END
       WHERE id = $2
       RETURNING *`,
      [status, recommendationId]
    );

    return recommendation;
  } catch (error) {
    console.error('Recommendation update error:', error);
    throw error;
  }
}

/**
 * Update student mastery for a skill
 * @param {Object} masteryData - Mastery data
 * @returns {Promise<Object>} - Updated mastery record
 */
export async function updateStudentMastery(masteryData) {
  const {
    userId,
    appCode,
    skillId,
    skillName,
    unitsCompleted = 0,
    totalUnits = 0
  } = masteryData;

  if (!userId || !appCode || !skillId || !skillName) {
    throw new Error('Missing required fields for mastery update');
  }

  try {
    // Calculate proficiency based on units completed
    let proficiency = 'beginner';
    if (totalUnits > 0) {
      const completionRate = unitsCompleted / totalUnits;
      if (completionRate >= 0.9) proficiency = 'expert';
      else if (completionRate >= 0.7) proficiency = 'advanced';
      else if (completionRate >= 0.5) proficiency = 'intermediate';
    }

    const masteryLevel = totalUnits > 0
      ? Math.round((unitsCompleted / totalUnits) * 100)
      : 0;

    const mastery = await db.one(
      `INSERT INTO student_mastery
        (user_id, app_code, skill_id, skill_name, mastery_level, proficiency,
         units_completed, total_units, last_practiced_at, last_assessed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (user_id, app_code, skill_id) DO UPDATE SET
         mastery_level = $5,
         proficiency = $6,
         units_completed = $7,
         total_units = $8,
         last_practiced_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [userId, appCode, skillId, skillName, masteryLevel, proficiency, unitsCompleted, totalUnits]
    );

    return mastery;
  } catch (error) {
    console.error('Mastery update error:', error);
    throw error;
  }
}

/**
 * Get student's mastery profile
 * @param {string} userId - Student user ID
 * @param {string} appCode - App code (optional filter)
 * @returns {Promise<Array>} - Mastery records
 */
export async function getStudentMastery(userId, appCode = null) {
  try {
    let query = `SELECT * FROM student_mastery WHERE user_id = $1`;
    const params = [userId];

    if (appCode) {
      query += ` AND app_code = $2`;
      params.push(appCode);
    }

    query += ` ORDER BY app_code, proficiency DESC`;

    const mastery = await db.many(query, params);
    return mastery;
  } catch (error) {
    console.error('Mastery fetch error:', error);
    throw error;
  }
}

/**
 * Log progress sync event
 * @param {Object} syncData - Sync data
 * @returns {Promise<Object>} - Sync log entry
 */
export async function logProgressSync(syncData) {
  const {
    appCode,
    syncType,
    recordsSynced = 0,
    recordsCreated = 0,
    recordsUpdated = 0,
    status = 'success',
    errorMessage = null
  } = syncData;

  try {
    const log = await db.one(
      `INSERT INTO progress_sync_log
        (app_code, sync_type, records_synced, records_created, records_updated, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [appCode, syncType, recordsSynced, recordsCreated, recordsUpdated, status, errorMessage]
    );

    return log;
  } catch (error) {
    console.error('Sync log error:', error);
    throw error;
  }
}

/**
 * Calculate class insights (struggling students, popular apps, etc.)
 * @param {string} classId - Class ID
 * @returns {Promise<Object>} - Insights
 */
export async function getClassInsights(classId) {
  try {
    // Students struggling
    const strugglingStudents = await db.many(
      `SELECT u.id, u.first_name, u.last_name,
              COUNT(*) as struggles,
              AVG(p.score) as avg_score
       FROM core_users u
       JOIN unified_student_progress p ON u.id = p.user_id
       WHERE p.class_id = $1 AND p.status = 'struggling'
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY struggles DESC
       LIMIT 5`,
      [classId]
    );

    // Most popular apps
    const popularApps = await db.many(
      `SELECT app_code, COUNT(*) as activity_count
       FROM unified_student_progress
       WHERE class_id = $1
       GROUP BY app_code
       ORDER BY activity_count DESC`,
      [classId]
    );

    // Completion rates
    const completionRates = await db.many(
      `SELECT app_code,
              COUNT(*) as total,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
              ROUND(100.0 * COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*)) as completion_pct
       FROM unified_student_progress
       WHERE class_id = $1
       GROUP BY app_code`,
      [classId]
    );

    return {
      strugglingStudents,
      popularApps,
      completionRates
    };
  } catch (error) {
    console.error('Class insights error:', error);
    throw error;
  }
}
