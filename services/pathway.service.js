/**
 * Learning Pathways Service
 *
 * Manages structured learning journeys with multi-step sequences, enrollment,
 * progress tracking, and AI-generated recommendations for students.
 */

import db from '../db.js';

/**
 * Create a new learning pathway
 * @param {Object} pathwayData - Pathway definition
 * @returns {Promise<Object>} - Created pathway
 */
export async function createPathway(pathwayData) {
  const {
    brandId,
    code,
    title,
    description = null,
    pathwayType = 'core',
    targetProficiency = 'intermediate',
    appCode,
    topicIds = [],
    difficultyLevel = null,
    estimatedHours = null,
    isSequential = true,
    recommendedForGaps = [],
    tags = []
  } = pathwayData;

  if (!brandId || !code || !title || !appCode) {
    throw new Error('Missing required fields: brandId, code, title, appCode');
  }

  try {
    const pathway = await db.one(
      `INSERT INTO learning_pathways
        (brand_id, code, title, description, pathway_type, target_proficiency, app_code,
         topic_ids, difficulty_level, estimated_hours, is_sequential, recommended_for_gaps, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        brandId, code, title, description, pathwayType, targetProficiency, appCode,
        topicIds, difficultyLevel, estimatedHours, isSequential, recommendedForGaps, tags
      ]
    );

    return transformPathway(pathway);
  } catch (error) {
    console.error('Error creating pathway:', error);
    throw error;
  }
}

/**
 * Get pathway with all its steps
 * @param {string} pathwayId - Pathway ID
 * @returns {Promise<Object>} - Pathway with steps
 */
export async function getPathwayWithSteps(pathwayId) {
  try {
    const pathway = await db.one(
      `SELECT * FROM learning_pathways WHERE id = $1`,
      [pathwayId]
    );

    if (!pathway) {
      throw new Error(`Pathway ${pathwayId} not found`);
    }

    const steps = await db.many(
      `SELECT
        ps.id, ps.pathway_id, ps.step_order, ps.step_type,
        ps.level_id, ps.unit_id, ps.unit_assessment_id,
        ps.prerequisite_step_ids, ps.is_required, ps.estimated_minutes,
        l.type AS level_title, u.name AS unit_title, ua.assessment_type AS assessment_title
       FROM pathway_steps ps
       LEFT JOIN level l ON l.id = ps.level_id
       LEFT JOIN unit u ON u.id = ps.unit_id
       LEFT JOIN unit_assessments ua ON ua.id = ps.unit_assessment_id
       WHERE ps.pathway_id = $1
       ORDER BY ps.step_order ASC`,
      [pathwayId]
    );

    return {
      ...transformPathway(pathway),
      steps: steps.map(transformStep)
    };
  } catch (error) {
    console.error('Error fetching pathway:', error);
    throw error;
  }
}

/**
 * Get public pathways with optional filtering
 * @param {Object} filters - { appCode?, pathwayType?, proficiency?, topic?, search? }
 * @returns {Promise<Array>} - Matching pathways
 */
export async function getPublicPathways(filters = {}) {
  const { appCode, pathwayType, proficiency, topic, search } = filters;

  let query = `SELECT * FROM learning_pathways WHERE is_active = TRUE`;
  const params = [];
  let paramIndex = 1;

  if (appCode) {
    query += ` AND app_code = $${paramIndex}`;
    params.push(appCode);
    paramIndex++;
  }

  if (pathwayType) {
    query += ` AND pathway_type = $${paramIndex}`;
    params.push(pathwayType);
    paramIndex++;
  }

  if (proficiency) {
    query += ` AND target_proficiency = $${paramIndex}`;
    params.push(proficiency);
    paramIndex++;
  }

  if (topic) {
    query += ` AND $${paramIndex} = ANY(topic_ids)`;
    params.push(topic);
    paramIndex++;
  }

  if (search) {
    query += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC`;

  try {
    const pathways = await db.many(query, params);
    return pathways.map(transformPathway);
  } catch (error) {
    console.error('Error fetching public pathways:', error);
    throw error;
  }
}

/**
 * Update pathway metadata
 * @param {string} pathwayId - Pathway ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - Updated pathway
 */
export async function updatePathway(pathwayId, updates) {
  const {
    title,
    description,
    pathwayType,
    targetProficiency,
    topicIds,
    difficultyLevel,
    estimatedHours,
    isSequential,
    recommendedForGaps,
    tags,
    isActive
  } = updates;

  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (title !== undefined) {
    fields.push(`title = $${paramIndex}`);
    values.push(title);
    paramIndex++;
  }
  if (description !== undefined) {
    fields.push(`description = $${paramIndex}`);
    values.push(description);
    paramIndex++;
  }
  if (pathwayType !== undefined) {
    fields.push(`pathway_type = $${paramIndex}`);
    values.push(pathwayType);
    paramIndex++;
  }
  if (targetProficiency !== undefined) {
    fields.push(`target_proficiency = $${paramIndex}`);
    values.push(targetProficiency);
    paramIndex++;
  }
  if (topicIds !== undefined) {
    fields.push(`topic_ids = $${paramIndex}`);
    values.push(topicIds);
    paramIndex++;
  }
  if (difficultyLevel !== undefined) {
    fields.push(`difficulty_level = $${paramIndex}`);
    values.push(difficultyLevel);
    paramIndex++;
  }
  if (estimatedHours !== undefined) {
    fields.push(`estimated_hours = $${paramIndex}`);
    values.push(estimatedHours);
    paramIndex++;
  }
  if (isSequential !== undefined) {
    fields.push(`is_sequential = $${paramIndex}`);
    values.push(isSequential);
    paramIndex++;
  }
  if (recommendedForGaps !== undefined) {
    fields.push(`recommended_for_gaps = $${paramIndex}`);
    values.push(recommendedForGaps);
    paramIndex++;
  }
  if (tags !== undefined) {
    fields.push(`tags = $${paramIndex}`);
    values.push(tags);
    paramIndex++;
  }
  if (isActive !== undefined) {
    fields.push(`is_active = $${paramIndex}`);
    values.push(isActive);
    paramIndex++;
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(pathwayId);

  try {
    const updated = await db.one(
      `UPDATE learning_pathways SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    return transformPathway(updated);
  } catch (error) {
    console.error('Error updating pathway:', error);
    throw error;
  }
}

/**
 * Delete (soft-delete) a pathway
 * @param {string} pathwayId - Pathway ID
 * @returns {Promise<void>}
 */
export async function deletePathway(pathwayId) {
  try {
    await db.query(
      `UPDATE learning_pathways SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [pathwayId]
    );
  } catch (error) {
    console.error('Error deleting pathway:', error);
    throw error;
  }
}

/**
 * Add a step to a pathway
 * @param {string} pathwayId - Pathway ID
 * @param {Object} stepData - Step data
 * @returns {Promise<Object>} - Created step
 */
export async function addPathwayStep(pathwayId, stepData) {
  const {
    brandId,
    stepOrder,
    stepType,
    levelId = null,
    unitId = null,
    unitAssessmentId = null,
    prerequisiteStepIds = [],
    isRequired = true,
    estimatedMinutes = null
  } = stepData;

  // Validate exactly one content reference
  const contentRefs = [levelId, unitId, unitAssessmentId].filter(x => x).length;
  if (contentRefs !== 1) {
    throw new Error('Exactly one of levelId, unitId, or unitAssessmentId must be provided');
  }

  try {
    const step = await db.one(
      `INSERT INTO pathway_steps
        (pathway_id, brand_id, step_order, step_type, level_id, unit_id, unit_assessment_id,
         prerequisite_step_ids, is_required, estimated_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        pathwayId, brandId, stepOrder, stepType, levelId, unitId, unitAssessmentId,
        prerequisiteStepIds, isRequired, estimatedMinutes
      ]
    );

    return transformStep(step);
  } catch (error) {
    console.error('Error adding pathway step:', error);
    throw error;
  }
}

/**
 * Reorder pathway steps
 * @param {string} pathwayId - Pathway ID
 * @param {Array} stepOrders - [{stepId, newOrder}, ...]
 * @returns {Promise<void>}
 */
export async function reorderPathwaySteps(pathwayId, stepOrders) {
  try {
    await db.tx(async (tx) => {
      for (const { stepId, newOrder } of stepOrders) {
        await tx.query(
          `UPDATE pathway_steps SET step_order = $1, updated_at = NOW()
           WHERE id = $2 AND pathway_id = $3`,
          [newOrder, stepId, pathwayId]
        );
      }
    });
  } catch (error) {
    console.error('Error reordering pathway steps:', error);
    throw error;
  }
}

/**
 * Enroll student in a pathway
 * @param {string} userId - Student user ID
 * @param {string} pathwayId - Pathway ID
 * @param {string} enrollmentType - 'self_enrolled', 'teacher_assigned', etc.
 * @param {string} brandId - Brand ID
 * @returns {Promise<Object>} - Enrollment record
 */
export async function enrollStudent(userId, pathwayId, enrollmentType = 'self_enrolled', brandId) {
  try {
    return await db.tx(async (tx) => {
      // Check prerequisites
      const pathway = await tx.one(
        `SELECT prerequisite_pathway_ids FROM learning_pathways WHERE id = $1`,
        [pathwayId]
      );

      if (pathway.prerequisite_pathway_ids && pathway.prerequisite_pathway_ids.length > 0) {
        for (const preqPathwayId of pathway.prerequisite_pathway_ids) {
          const completed = await tx.one(
            `SELECT 1 FROM student_pathway_progress
             WHERE user_id = $1 AND pathway_id = $2 AND status = 'completed'`,
            [userId, preqPathwayId]
          );

          if (!completed) {
            throw new Error(`Prerequisite pathway not completed: ${preqPathwayId}`);
          }
        }
      }

      // Get total step count
      const stepCount = await tx.one(
        `SELECT COUNT(*) as total FROM pathway_steps WHERE pathway_id = $1`,
        [pathwayId]
      );

      // Create enrollment
      const enrollment = await tx.one(
        `INSERT INTO student_pathway_progress
          (brand_id, user_id, pathway_id, enrollment_type, status, total_steps, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, pathway_id) DO UPDATE SET
           status = CASE WHEN student_pathway_progress.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
           updated_at = NOW()
         RETURNING *`,
        [brandId, userId, pathwayId, enrollmentType, 'in_progress', stepCount.total]
      );

      // Create step progress records
      const steps = await tx.many(
        `SELECT id FROM pathway_steps WHERE pathway_id = $1 ORDER BY step_order ASC`,
        [pathwayId]
      );

      for (const step of steps) {
        await tx.query(
          `INSERT INTO student_step_progress (brand_id, user_id, pathway_id, step_id, status)
           VALUES ($1, $2, $3, $4, 'not_started')
           ON CONFLICT (user_id, pathway_id, step_id) DO NOTHING`,
          [brandId, userId, pathwayId, step.id]
        );
      }

      return transformEnrollment(enrollment);
    });
  } catch (error) {
    console.error('Error enrolling student:', error);
    throw error;
  }
}

/**
 * Update student step progress
 * @param {string} userId - Student user ID
 * @param {string} pathwayId - Pathway ID
 * @param {string} stepId - Step ID
 * @param {Object} progressData - { status, score?, passed?, timeSpentSeconds? }
 * @returns {Promise<Object>} - Updated step progress
 */
export async function updateStepProgress(userId, pathwayId, stepId, progressData) {
  const {
    status = 'in_progress',
    score = null,
    passed = null,
    timeSpentSeconds = 0
  } = progressData;

  try {
    return await db.tx(async (tx) => {
      // Update step progress
      const stepProgress = await tx.one(
        `UPDATE student_step_progress
         SET status = $1, score = $2, passed = $3,
             time_spent_seconds = time_spent_seconds + $4,
             completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE user_id = $5 AND pathway_id = $6 AND step_id = $7
         RETURNING *`,
        [status, score, passed, timeSpentSeconds, userId, pathwayId, stepId]
      );

      // Get next step
      const currentStep = await tx.one(
        `SELECT step_order FROM pathway_steps WHERE id = $1`,
        [stepId]
      );

      const nextStep = await tx.one(
        `SELECT id, step_order FROM pathway_steps
         WHERE pathway_id = $1 AND step_order > $2
         ORDER BY step_order ASC LIMIT 1`,
        [pathwayId, currentStep.step_order]
      );

      // Update pathway progress
      await tx.query(
        `UPDATE student_pathway_progress
         SET current_step_id = $1, current_step_order = $2,
             last_activity_at = NOW(), updated_at = NOW(),
             status = CASE
               WHEN NOT EXISTS(
                 SELECT 1 FROM pathway_steps ps
                 WHERE ps.pathway_id = $3 AND ps.is_required = TRUE
                 AND NOT EXISTS(
                   SELECT 1 FROM student_step_progress ssp
                   WHERE ssp.user_id = $4 AND ssp.pathway_id = $3
                   AND ssp.step_id = ps.id AND ssp.status = 'completed'
                 )
               ) THEN 'completed'
               ELSE status
             END
         WHERE user_id = $4 AND pathway_id = $3`,
        [
          nextStep ? nextStep.id : null,
          nextStep ? nextStep.step_order : null,
          pathwayId,
          userId
        ]
      );

      return transformStepProgress(stepProgress);
    });
  } catch (error) {
    console.error('Error updating step progress:', error);
    throw error;
  }
}

/**
 * Get student's enrolled pathways
 * @param {string} userId - Student user ID
 * @param {Object} filters - { status?, appCode? }
 * @returns {Promise<Array>} - Enrolled pathways
 */
export async function getStudentPathways(userId, filters = {}) {
  const { status, appCode } = filters;

  let query = `
    SELECT
      spp.id, spp.user_id, spp.pathway_id, spp.enrollment_type, spp.status,
      spp.current_step_id, spp.current_step_order, spp.steps_completed, spp.total_steps,
      spp.average_score, spp.expected_completion_date, spp.last_activity_at,
      spp.created_at, spp.updated_at,
      p.code, p.title, p.app_code, p.description, p.target_proficiency
    FROM student_pathway_progress spp
    JOIN learning_pathways p ON p.id = spp.pathway_id
    WHERE spp.user_id = $1`;

  const params = [userId];
  let paramIndex = 2;

  if (status) {
    query += ` AND spp.status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  if (appCode) {
    query += ` AND p.app_code = $${paramIndex}`;
    params.push(appCode);
    paramIndex++;
  }

  query += ` ORDER BY spp.last_activity_at DESC NULLS LAST`;

  try {
    const pathways = await db.many(query, params);
    return pathways.map(transformStudentPathway);
  } catch (error) {
    console.error('Error fetching student pathways:', error);
    throw error;
  }
}

/**
 * Get detailed step progress for a pathway
 * @param {string} userId - Student user ID
 * @param {string} pathwayId - Pathway ID
 * @returns {Promise<Object>} - Pathway with all step progress
 */
export async function getStudentStepProgress(userId, pathwayId) {
  try {
    const enrollmentData = await db.one(
      `SELECT spp.*, p.code, p.title, p.is_sequential
       FROM student_pathway_progress spp
       JOIN learning_pathways p ON p.id = spp.pathway_id
       WHERE spp.user_id = $1 AND spp.pathway_id = $2`,
      [userId, pathwayId]
    );

    if (!enrollmentData) {
      throw new Error('Enrollment not found');
    }

    const steps = await db.many(
      `SELECT
        ps.id, ps.step_order, ps.step_type, ps.is_required,
        ps.level_id, ps.unit_id, ps.unit_assessment_id,
        l.type AS level_title, u.name AS unit_title, ua.assessment_type AS assessment_title,
        ssp.status, ssp.score, ssp.passed, ssp.time_spent_seconds, ssp.completed_at
       FROM pathway_steps ps
       LEFT JOIN student_step_progress ssp ON ssp.step_id = ps.id AND ssp.user_id = $1
       LEFT JOIN level l ON l.id = ps.level_id
       LEFT JOIN unit u ON u.id = ps.unit_id
       LEFT JOIN unit_assessments ua ON ua.id = ps.unit_assessment_id
       WHERE ps.pathway_id = $2
       ORDER BY ps.step_order ASC`,
      [userId, pathwayId]
    );

    return {
      ...transformEnrollment(enrollmentData),
      steps: steps.map(transformStepWithProgress)
    };
  } catch (error) {
    console.error('Error fetching step progress:', error);
    throw error;
  }
}

/**
 * Generate pathway recommendations based on competency gaps
 * @param {string} userId - Student user ID
 * @param {string} appCode - App code (e.g., 'law')
 * @param {string} brandId - Brand ID
 * @returns {Promise<Array>} - Top pathway recommendations
 */
export async function generatePathwayRecommendations(userId, appCode, brandId) {
  try {
    // Get student's competency gaps from assessments
    const gaps = await db.many(
      `SELECT DISTINCT topic_id FROM unified_student_progress
       WHERE user_id = $1 AND app_code = $2 AND (status = 'struggling' OR (score IS NOT NULL AND score < 70))
       LIMIT 5`,
      [userId, appCode]
    );

    if (gaps.length === 0) {
      // No gaps, recommend advanced pathways
      const pathways = await db.many(
        `SELECT id, code, title, target_proficiency, (0.6::numeric) as confidence
         FROM learning_pathways
         WHERE brand_id = $1 AND app_code = $2 AND pathway_type IN ('advanced', 'certification')
         AND is_active = TRUE
         ORDER BY created_at DESC LIMIT 5`,
        [brandId, appCode]
      );

      return pathways.map(p => ({
        pathwayId: p.id,
        code: p.code,
        title: p.title,
        reason: 'performance_trend',
        confidence: p.confidence,
        basedOnCompetencyGaps: []
      }));
    }

    const gapTopics = gaps.map(g => g.topic_id);

    // Find pathways targeting these gaps
    const recommendations = await db.many(
      `SELECT DISTINCT
        p.id, p.code, p.title, p.target_proficiency, p.topic_ids,
        (0.7 + (array_length(array_intersect(p.recommended_for_gaps, $1::TEXT[]), 1)::numeric / 10)) as confidence
       FROM learning_pathways p
       WHERE p.brand_id = $2 AND p.app_code = $3
       AND p.is_active = TRUE
       AND (
         array_length(array_intersect(p.topic_ids, $4::TEXT[]), 1) > 0
         OR array_length(array_intersect(p.recommended_for_gaps, $1::TEXT[]), 1) > 0
       )
       AND NOT EXISTS(
         SELECT 1 FROM student_pathway_progress spp
         WHERE spp.user_id = $5 AND spp.pathway_id = p.id AND spp.status = 'completed'
       )
       ORDER BY confidence DESC
       LIMIT 5`,
      [
        gapTopics,
        brandId,
        appCode,
        gapTopics,
        userId
      ]
    );

    // Create recommendation records
    for (const rec of recommendations) {
      await db.query(
        `INSERT INTO pathway_recommendations
          (brand_id, user_id, pathway_id, reason, confidence, based_on_competency_gaps)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, pathway_id, recommended_at) DO NOTHING`,
        [brandId, userId, rec.id, 'competency_gap', rec.confidence, gapTopics]
      );
    }

    return recommendations.map(transformRecommendation);
  } catch (error) {
    console.error('Error generating recommendations:', error);
    throw error;
  }
}

/**
 * Get pathway analytics
 * @param {string} pathwayId - Pathway ID
 * @returns {Promise<Object>} - Analytics data
 */
export async function getPathwayAnalytics(pathwayId) {
  try {
    const summary = await db.one(
      `SELECT
        enrolled_students, completed_students, completion_rate_pct, avg_score, avg_duration_seconds
       FROM pathway_progress_summary
       WHERE pathway_id = $1`,
      [pathwayId]
    );

    const stepAnalytics = await db.many(
      `SELECT
        ps.step_order, ps.step_type,
        COUNT(DISTINCT ssp.user_id) as attempted_count,
        COUNT(DISTINCT CASE WHEN ssp.status = 'completed' THEN ssp.user_id END) as completed_count,
        ROUND(AVG(ssp.score), 2) as avg_score,
        ROUND(AVG(ssp.time_spent_seconds), 0) as avg_time_seconds
       FROM pathway_steps ps
       LEFT JOIN student_step_progress ssp ON ssp.step_id = ps.id
       WHERE ps.pathway_id = $1
       GROUP BY ps.id, ps.step_order, ps.step_type
       ORDER BY ps.step_order ASC`,
      [pathwayId]
    );

    return {
      enrollment: {
        totalEnrolled: summary?.enrolled_students || 0,
        completed: summary?.completed_students || 0,
        completionRatePercent: summary?.completion_rate_pct || 0,
        averageScore: summary?.avg_score || null,
        averageDurationSeconds: summary?.avg_duration_seconds || null
      },
      stepAnalytics: stepAnalytics.map(transformStepAnalytic)
    };
  } catch (error) {
    console.error('Error fetching pathway analytics:', error);
    throw error;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function transformPathway(row) {
  if (!row) return null;
  return {
    id: row.id,
    brandId: row.brand_id,
    code: row.code,
    title: row.title,
    description: row.description,
    pathwayType: row.pathway_type,
    targetProficiency: row.target_proficiency,
    appCode: row.app_code,
    topicIds: row.topic_ids,
    prerequisitePathwayIds: row.prerequisite_pathway_ids,
    isSequential: row.is_sequential,
    recommendedForGaps: row.recommended_for_gaps,
    tags: row.tags,
    estimatedHours: row.estimated_hours,
    difficultyLevel: row.difficulty_level,
    metadata: row.metadata,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function transformStep(row) {
  if (!row) return null;
  return {
    id: row.id,
    pathwayId: row.pathway_id,
    stepOrder: row.step_order,
    stepType: row.step_type,
    levelId: row.level_id,
    levelTitle: row.level_title,
    unitId: row.unit_id,
    unitTitle: row.unit_title,
    unitAssessmentId: row.unit_assessment_id,
    prerequisiteStepIds: row.prerequisite_step_ids,
    isRequired: row.is_required,
    estimatedMinutes: row.estimated_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function transformEnrollment(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    pathwayId: row.pathway_id,
    pathwayCode: row.code,
    pathwayTitle: row.title,
    enrollmentType: row.enrollment_type,
    status: row.status,
    currentStepId: row.current_step_id,
    currentStepOrder: row.current_step_order,
    stepsCompleted: row.steps_completed,
    totalSteps: row.total_steps,
    progressPercent: row.total_steps > 0 ? Math.round((row.steps_completed / row.total_steps) * 100) : 0,
    averageScore: row.average_score ? parseFloat(row.average_score) : null,
    expectedCompletionDate: row.expected_completion_date,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function transformStudentPathway(row) {
  return {
    id: row.id,
    userId: row.user_id,
    pathwayId: row.pathway_id,
    code: row.code,
    title: row.title,
    appCode: row.app_code,
    description: row.description,
    targetProficiency: row.target_proficiency,
    enrollmentType: row.enrollment_type,
    status: row.status,
    currentStepOrder: row.current_step_order,
    stepsCompleted: row.steps_completed,
    totalSteps: row.total_steps,
    progressPercent: row.total_steps > 0 ? Math.round((row.steps_completed / row.total_steps) * 100) : 0,
    averageScore: row.average_score ? parseFloat(row.average_score) : null,
    expectedCompletionDate: row.expected_completion_date,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function transformStepProgress(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    pathwayId: row.pathway_id,
    stepId: row.step_id,
    status: row.status,
    score: row.score ? parseFloat(row.score) : null,
    passed: row.passed,
    timeSpentSeconds: row.time_spent_seconds,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function transformStepWithProgress(row) {
  return {
    id: row.id,
    stepOrder: row.step_order,
    stepType: row.step_type,
    isRequired: row.is_required,
    content: {
      levelId: row.level_id,
      levelTitle: row.level_title,
      unitId: row.unit_id,
      unitTitle: row.unit_title,
      unitAssessmentId: row.unit_assessment_id,
      assessmentTitle: row.assessment_title
    },
    progress: {
      status: row.status,
      score: row.score,
      passed: row.passed,
      timeSpentSeconds: row.time_spent_seconds,
      completedAt: row.completed_at
    }
  };
}

function transformRecommendation(row) {
  return {
    pathwayId: row.id,
    code: row.code,
    title: row.title,
    targetProficiency: row.target_proficiency,
    topicIds: row.topic_ids,
    reason: 'competency_gap',
    confidence: parseFloat(row.confidence)
  };
}

function transformStepAnalytic(row) {
  return {
    stepOrder: row.step_order,
    stepType: row.step_type,
    attemptedCount: row.attempted_count || 0,
    completedCount: row.completed_count || 0,
    completionRate: row.attempted_count > 0 ? Math.round((row.completed_count / row.attempted_count) * 100) : 0,
    averageScore: row.avg_score ? parseFloat(row.avg_score) : null,
    averageTimeSeconds: row.avg_time_seconds ? parseInt(row.avg_time_seconds) : null
  };
}
