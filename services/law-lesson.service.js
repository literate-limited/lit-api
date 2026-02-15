/**
 * Law Lesson Service
 *
 * Handles lesson content delivery, objectives, prerequisites, and progress tracking
 * Integrates with unified progress system for cross-app learning
 */

import db from '../db.js';

/**
 * Get lesson with all metadata and prerequisites
 * @param {string} levelId - Lesson/level ID
 * @returns {Promise<Object>} Complete lesson with metadata
 */
export async function getLessonWithMetadata(levelId) {
  try {
    const lesson = await db.one(
      `SELECT
        l.id, l.unit_id, l.type, l.content, l.level_order,
        u.name as unit_name, u.topic_id,
        lm.objectives, lm.learning_outcomes, lm.estimated_time_minutes,
        lm.difficulty_level, lm.content_type, lm.semantic_tags,
        lm.prerequisite_lesson_id, lm.is_active
       FROM level l
       JOIN unit u ON l.unit_id = u.id
       LEFT JOIN lesson_metadata lm ON l.id = lm.level_id
       WHERE l.id = $1`,
      [levelId]
    );

    if (!lesson) {
      throw new Error('Lesson not found');
    }

    // Get prerequisite lesson if exists
    let prerequisiteLesson = null;
    if (lesson.prerequisite_lesson_id) {
      prerequisiteLesson = await db.one(
        `SELECT l.id, l.type, lm.id as metadata_id
         FROM level l
         LEFT JOIN lesson_metadata lm ON l.id = lm.level_id
         WHERE l.id = $1`,
        [lesson.prerequisite_lesson_id]
      );
    }

    return {
      id: lesson.id,
      unitId: lesson.unit_id,
      unitName: lesson.unit_name,
      topicId: lesson.topic_id,
      type: lesson.type,
      content: lesson.content,
      levelOrder: lesson.level_order,
      objectives: lesson.objectives || [],
      learningOutcomes: lesson.learning_outcomes || [],
      estimatedTimeMinutes: lesson.estimated_time_minutes,
      difficultyLevel: lesson.difficulty_level,
      contentType: lesson.content_type,
      semanticTags: lesson.semantic_tags || [],
      isActive: lesson.is_active,
      prerequisiteLesson: prerequisiteLesson,
      prerequisiteLessonId: lesson.prerequisite_lesson_id
    };
  } catch (error) {
    console.error('Lesson retrieval error:', error);
    throw error;
  }
}

/**
 * Get all lessons in a unit with metadata
 * @param {string} unitId - Unit ID
 * @returns {Promise<Array>} Array of lessons with metadata
 */
export async function getUnitLessons(unitId) {
  try {
    const lessons = await db.many(
      `SELECT
        l.id, l.unit_id, l.type, l.content, l.level_order,
        lm.objectives, lm.learning_outcomes, lm.estimated_time_minutes,
        lm.difficulty_level, lm.content_type, lm.prerequisite_lesson_id,
        lm.is_active
       FROM level l
       LEFT JOIN lesson_metadata lm ON l.id = lm.level_id
       WHERE l.unit_id = $1
       ORDER BY l.level_order ASC`,
      [unitId]
    );

    return lessons.map(lesson => ({
      id: lesson.id,
      unitId: lesson.unit_id,
      type: lesson.type,
      content: lesson.content,
      levelOrder: lesson.level_order,
      objectives: lesson.objectives || [],
      learningOutcomes: lesson.learning_outcomes || [],
      estimatedTimeMinutes: lesson.estimated_time_minutes,
      difficultyLevel: lesson.difficulty_level,
      contentType: lesson.content_type,
      isActive: lesson.is_active,
      prerequisiteLessonId: lesson.prerequisite_lesson_id
    }));
  } catch (error) {
    console.error('Unit lessons retrieval error:', error);
    throw error;
  }
}

/**
 * Get lessons by difficulty level
 * @param {string} difficultyLevel - 'beginner', 'intermediate', 'advanced'
 * @param {string} topicId - Optional filter by topic
 * @returns {Promise<Array>} Lessons matching criteria
 */
export async function getLessonsByDifficulty(difficultyLevel, topicId = null) {
  try {
    let query = `
      SELECT
        l.id, l.unit_id, l.type, l.level_order,
        u.name as unit_name, u.topic_id,
        lm.estimated_time_minutes, lm.difficulty_level, lm.content_type
       FROM level l
       JOIN unit u ON l.unit_id = u.id
       LEFT JOIN lesson_metadata lm ON l.id = lm.level_id
       WHERE lm.difficulty_level = $1 AND lm.is_active = TRUE
    `;

    const params = [difficultyLevel];

    if (topicId) {
      query += ` AND u.topic_id = $${params.length + 1}`;
      params.push(topicId);
    }

    query += ` ORDER BY u.topic_id, l.level_order ASC`;

    const lessons = await db.many(query, params);
    return lessons;
  } catch (error) {
    console.error('Lessons by difficulty retrieval error:', error);
    throw error;
  }
}

/**
 * Get prerequisite chain for a lesson
 * Returns array of lessons in order of prerequisites
 * @param {string} levelId - Lesson ID
 * @returns {Promise<Array>} Array of prerequisite lessons in order
 */
export async function getPrerequisiteChain(levelId) {
  try {
    const chain = [];
    let currentId = levelId;

    // Follow the prerequisite chain backwards
    while (currentId) {
      const lesson = await db.one(
        `SELECT l.id, l.type, l.level_order, u.name as unit_name,
                lm.prerequisite_lesson_id, lm.objectives, lm.estimated_time_minutes
         FROM level l
         LEFT JOIN unit u ON l.unit_id = u.id
         LEFT JOIN lesson_metadata lm ON l.id = lm.level_id
         WHERE l.id = $1`,
        [currentId]
      );

      if (!lesson) break;

      chain.unshift({
        id: lesson.id,
        type: lesson.type,
        unitName: lesson.unit_name,
        levelOrder: lesson.level_order,
        objectives: lesson.objectives || []
      });

      currentId = lesson.prerequisite_lesson_id;
    }

    return chain;
  } catch (error) {
    console.error('Prerequisite chain retrieval error:', error);
    throw error;
  }
}

/**
 * Check if student has completed prerequisite
 * @param {string} userId - Student user ID
 * @param {string} levelId - Lesson ID to check prerequisites for
 * @returns {Promise<Object>} {hasCompleted, prerequisiteId, prerequisiteName}
 */
export async function checkPrerequisiteCompletion(userId, levelId) {
  try {
    const lesson = await db.one(
      `SELECT lm.prerequisite_lesson_id
       FROM lesson_metadata lm
       WHERE lm.level_id = $1`,
      [levelId]
    );

    if (!lesson || !lesson.prerequisite_lesson_id) {
      return { hasCompleted: true, prerequisiteId: null };
    }

    const prerequisiteId = lesson.prerequisite_lesson_id;

    // Check if student has completed the prerequisite
    let completion = null;
    try {
      completion = await db.one(
        `SELECT
          usp.id, usp.status, usp.score
         FROM unified_student_progress usp
         WHERE usp.user_id = $1 AND usp.level_id = $2 AND usp.status IN ('completed', 'mastered')`,
        [userId, prerequisiteId]
      );
    } catch (e) {
      // Prerequisite not completed
      completion = null;
    }

    const prerequisiteLesson = await db.one(
      `SELECT l.type FROM level l WHERE l.id = $1`,
      [prerequisiteId]
    );

    return {
      hasCompleted: !!completion,
      prerequisiteId,
      prerequisiteCompleted: !!completion,
      score: completion?.score || null
    };
  } catch (error) {
    console.error('Prerequisite check error:', error);
    throw error;
  }
}

/**
 * Get lessons by semantic tags
 * Useful for finding related content
 * @param {Array<string>} tags - Semantic tags to search for
 * @param {number} limit - Max results
 * @returns {Promise<Array>} Lessons matching tags
 */
export async function getLessonsByTags(tags, limit = 10) {
  try {
    const lessons = await db.many(
      `SELECT DISTINCT
        l.id, l.unit_id, l.type, l.level_order,
        u.name as unit_name, u.topic_id,
        lm.objectives, lm.estimated_time_minutes, lm.difficulty_level
       FROM level l
       JOIN unit u ON l.unit_id = u.id
       LEFT JOIN lesson_metadata lm ON l.id = lm.level_id
       WHERE lm.semantic_tags && $1 AND lm.is_active = TRUE
       ORDER BY
         lm.difficulty_level,
         u.topic_id,
         l.level_order
       LIMIT $2`,
      [tags, limit]
    );

    return lessons;
  } catch (error) {
    console.error('Lessons by tags retrieval error:', error);
    throw error;
  }
}

/**
 * Get recommended next lesson for student
 * Based on current progress and difficulty
 * @param {string} userId - Student user ID
 * @param {string} topicId - Topic to get next lesson from
 * @returns {Promise<Object>} Recommended next lesson
 */
export async function getRecommendedNextLesson(userId, topicId) {
  try {
    // Get student's current mastery level in this topic
    let mastery = null;
    try {
      mastery = await db.one(
        `SELECT m.mastery_level, m.proficiency
         FROM student_mastery m
         WHERE m.user_id = $1 AND m.app_code = 'law' AND m.skill_id = $2`,
        [userId, topicId]
      );
    } catch (e) {
      // No mastery record yet, assume beginner
      mastery = null;
    }

    let nextDifficulty = 'beginner';
    if (mastery) {
      if (mastery.proficiency === 'expert') {
        return null; // Student has mastered this topic
      }
      if (mastery.proficiency === 'advanced') {
        nextDifficulty = 'advanced';
      } else if (mastery.proficiency === 'intermediate') {
        nextDifficulty = 'advanced';
      }
    }

    // Get next lesson at appropriate difficulty
    let nextLesson = null;
    try {
      nextLesson = await db.one(
        `SELECT
          l.id, l.unit_id, l.type, l.level_order,
          u.name as unit_name, u.topic_id,
          lm.objectives, lm.estimated_time_minutes, lm.difficulty_level
         FROM level l
         JOIN unit u ON l.unit_id = u.id
         LEFT JOIN lesson_metadata lm ON l.id = lm.level_id
         WHERE u.topic_id = $1
           AND lm.difficulty_level = $2
           AND lm.is_active = TRUE
           AND l.id NOT IN (
             SELECT usp.level_id
             FROM unified_student_progress usp
             WHERE usp.user_id = $3 AND usp.status IN ('completed', 'mastered')
           )
         ORDER BY l.level_order ASC
         LIMIT 1`,
        [topicId, nextDifficulty, userId]
      );
    } catch (e) {
      // No next lesson available
      nextLesson = null;
    }

    return nextLesson;
  } catch (error) {
    console.error('Recommended lesson error:', error);
    throw error;
  }
}

/**
 * Update lesson metadata
 * @param {string} levelId - Lesson ID
 * @param {Object} metadata - Metadata to update
 * @returns {Promise<Object>} Updated metadata
 */
export async function updateLessonMetadata(levelId, metadata) {
  const {
    objectives,
    learningOutcomes,
    estimatedTimeMinutes,
    difficultyLevel,
    contentType,
    semanticTags,
    prerequisiteLessonId,
    isActive
  } = metadata;

  try {
    const updated = await db.one(
      `INSERT INTO lesson_metadata
        (level_id, objectives, learning_outcomes, estimated_time_minutes,
         difficulty_level, content_type, semantic_tags, prerequisite_lesson_id,
         is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (level_id) DO UPDATE SET
         objectives = COALESCE($2, lesson_metadata.objectives),
         learning_outcomes = COALESCE($3, lesson_metadata.learning_outcomes),
         estimated_time_minutes = COALESCE($4, lesson_metadata.estimated_time_minutes),
         difficulty_level = COALESCE($5, lesson_metadata.difficulty_level),
         content_type = COALESCE($6, lesson_metadata.content_type),
         semantic_tags = COALESCE($7, lesson_metadata.semantic_tags),
         prerequisite_lesson_id = $8,
         is_active = COALESCE($9, lesson_metadata.is_active),
         updated_at = NOW()
       RETURNING *`,
      [
        levelId,
        objectives || null,
        learningOutcomes || null,
        estimatedTimeMinutes || null,
        difficultyLevel || null,
        contentType || null,
        semanticTags || null,
        prerequisiteLessonId || null,
        isActive !== undefined ? isActive : null
      ]
    );

    return {
      levelId: updated.level_id,
      objectives: updated.objectives,
      learningOutcomes: updated.learning_outcomes,
      estimatedTimeMinutes: updated.estimated_time_minutes,
      difficultyLevel: updated.difficulty_level,
      contentType: updated.content_type,
      semanticTags: updated.semantic_tags,
      isActive: updated.is_active,
      updatedAt: updated.updated_at
    };
  } catch (error) {
    console.error('Lesson metadata update error:', error);
    throw error;
  }
}

/**
 * Get lesson progress statistics for a unit
 * @param {string} unitId - Unit ID
 * @returns {Promise<Object>} Statistics about lesson completion
 */
export async function getUnitLessonStats(unitId) {
  try {
    const stats = await db.one(
      `SELECT
        COUNT(DISTINCT l.id) as total_lessons,
        COUNT(DISTINCT l.id) FILTER (WHERE lm.difficulty_level = 'beginner') as beginner_lessons,
        COUNT(DISTINCT l.id) FILTER (WHERE lm.difficulty_level = 'intermediate') as intermediate_lessons,
        COUNT(DISTINCT l.id) FILTER (WHERE lm.difficulty_level = 'advanced') as advanced_lessons,
        AVG(lm.estimated_time_minutes) as avg_time_minutes,
        COALESCE(SUM(array_length(lm.objectives, 1)), 0) as total_objectives
       FROM level l
       LEFT JOIN lesson_metadata lm ON l.id = lm.level_id
       WHERE l.unit_id = $1 AND lm.is_active = TRUE`,
      [unitId]
    );

    return {
      totalLessons: stats.total_lessons || 0,
      byDifficulty: {
        beginner: stats.beginner_lessons || 0,
        intermediate: stats.intermediate_lessons || 0,
        advanced: stats.advanced_lessons || 0
      },
      averageTimeMinutes: stats.avg_time_minutes || 15,
      totalObjectives: stats.total_objectives || 0
    };
  } catch (error) {
    console.error('Unit lesson stats error:', error);
    throw error;
  }
}

/**
 * Track lesson view (for analytics)
 * @param {string} userId - Student user ID
 * @param {string} levelId - Lesson ID
 * @returns {Promise<void>}
 */
export async function trackLessonView(userId, levelId) {
  try {
    // This will be enhanced in Phase 2 to track analytics
    // For now, just log the event
    console.log(`Student ${userId} viewed lesson ${levelId}`);
  } catch (error) {
    console.error('Lesson view tracking error:', error);
    // Don't throw - this is non-critical
  }
}
