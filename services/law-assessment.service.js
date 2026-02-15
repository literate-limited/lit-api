/**
 * Law Assessment Service
 *
 * Handles assessments (pre-test, formative, summative, post-test)
 * Includes scoring, competency gap detection, and analytics
 * Integrates with unified progress system
 */

import db from '../db.js';

/**
 * Get assessment with all questions
 * @param {string} assessmentId - Assessment ID
 * @returns {Promise<Object>} Assessment with questions
 */
export async function getAssessment(assessmentId) {
  try {
    const assessment = await db.one(
      `SELECT id, unit_id, assessment_type, sequence_order, passing_score_required,
              time_limit_minutes, show_answers_after_submit, show_correct_answer_value,
              randomize_questions, randomize_options, allow_multiple_attempts,
              max_attempts, description, instructions, is_active
       FROM unit_assessments
       WHERE id = $1 AND is_active = TRUE`,
      [assessmentId]
    );

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    const questions = await db.many(
      `SELECT aq.id, aq.question_id, aq.sequence_order, aq.points,
              q.prompt, q.type, q.correct_answer, q.explanation
       FROM assessment_questions aq
       JOIN question q ON aq.question_id = q.id
       WHERE aq.assessment_id = $1
       ORDER BY aq.sequence_order ASC`,
      [assessmentId]
    );

    return {
      id: assessment.id,
      unitId: assessment.unit_id,
      type: assessment.assessment_type,
      passingScore: assessment.passing_score_required,
      timeLimitMinutes: assessment.time_limit_minutes,
      showAnswersAfter: assessment.show_answers_after_submit,
      showCorrectValue: assessment.show_correct_answer_value,
      randomizeQuestions: assessment.randomize_questions,
      randomizeOptions: assessment.randomize_options,
      allowMultipleAttempts: assessment.allow_multiple_attempts,
      maxAttempts: assessment.max_attempts,
      description: assessment.description,
      instructions: assessment.instructions,
      questions: questions,
      totalQuestions: questions.length,
      totalPoints: questions.reduce((sum, q) => sum + q.points, 0)
    };
  } catch (error) {
    console.error('Assessment retrieval error:', error);
    throw error;
  }
}

/**
 * Get all assessments for a unit
 * @param {string} unitId - Unit ID
 * @returns {Promise<Array>} Array of assessments in order
 */
export async function getUnitAssessments(unitId) {
  try {
    const assessments = await db.many(
      `SELECT id, unit_id, assessment_type, sequence_order, passing_score_required,
              time_limit_minutes, description
       FROM unit_assessments
       WHERE unit_id = $1 AND is_active = TRUE
       ORDER BY sequence_order ASC`,
      [unitId]
    );

    return assessments.map(a => ({
      id: a.id,
      unitId: a.unit_id,
      type: a.assessment_type,
      sequenceOrder: a.sequence_order,
      passingScore: a.passing_score_required,
      timeLimitMinutes: a.time_limit_minutes,
      description: a.description
    }));
  } catch (error) {
    console.error('Unit assessments retrieval error:', error);
    throw error;
  }
}

/**
 * Submit assessment answers and score
 * @param {string} assessmentId - Assessment ID
 * @param {string} userId - Student user ID
 * @param {Object} answers - {questionId: answerValue, ...}
 * @param {number} timeSpentSeconds - Time spent on assessment
 * @returns {Promise<Object>} Assessment result with score and feedback
 */
export async function submitAssessment(assessmentId, userId, answers, timeSpentSeconds) {
  try {
    // Get assessment and questions
    const assessment = await getAssessment(assessmentId);

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Score the assessment
    let correctAnswers = 0;
    const detailedResults = [];
    let totalPoints = 0;
    let earnedPoints = 0;

    for (const question of assessment.questions) {
      const userAnswer = answers[question.question_id];
      const isCorrect = userAnswer && userAnswer.toString() === question.correct_answer.toString();

      if (isCorrect) {
        correctAnswers++;
        earnedPoints += question.points;
      }
      totalPoints += question.points;

      detailedResults.push({
        questionId: question.question_id,
        prompt: question.prompt,
        userAnswer,
        correctAnswer: question.correct_answer,
        isCorrect,
        points: question.points,
        earnedPoints: isCorrect ? question.points : 0,
        explanation: question.explanation
      });
    }

    // Calculate score
    const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    const passed = score >= (assessment.passingScore * 100);

    // Record attempt
    const attempt = await db.one(
      `INSERT INTO student_assessment_attempts
        (assessment_id, user_id, attempt_number, submitted_at, time_spent_seconds,
         score, correct_answers, total_questions, passed, answers)
       SELECT $1, $2,
         COALESCE(MAX(attempt_number), 0) + 1,
         NOW(), $3, $4, $5, $6, $7, $8
       FROM student_assessment_attempts
       WHERE assessment_id = $1 AND user_id = $2
       RETURNING id, attempt_number, submitted_at, score, passed`,
      [assessmentId, userId, timeSpentSeconds, score, correctAnswers,
       assessment.totalQuestions, passed, JSON.stringify(answers)]
    );

    // Detect competency gaps for failed assessment
    let gaps = [];
    if (!passed && assessment.type === 'summative') {
      gaps = await identifyCompetencyGaps(userId, assessmentId, detailedResults);
    }

    // Update unified progress
    const unit = assessment.unitId;
    const topic = await db.one(
      `SELECT topic_id FROM unit WHERE id = $1`,
      [unit]
    );

    if (topic) {
      await db.query(
        `INSERT INTO unified_student_progress
          (brand_id, user_id, app_code, topic_id, unit_id, status, score, time_spent_seconds, metadata)
         SELECT (SELECT id FROM brands WHERE code = 'law'),
           $1, 'law', $2, $3,
           CASE WHEN $4 THEN 'completed'::TEXT ELSE 'struggling'::TEXT END,
           $5::NUMERIC, $6::INTEGER,
           jsonb_build_object('assessmentType', $7::TEXT, 'correctAnswers', $8::INTEGER)
         ON CONFLICT (user_id, app_code, unit_id) DO UPDATE SET
           status = CASE WHEN $4 THEN 'completed'::TEXT ELSE 'struggling'::TEXT END,
           score = $5::NUMERIC,
           time_spent_seconds = unified_student_progress.time_spent_seconds + $6::INTEGER,
           updated_at = NOW()`,
        [userId, topic.topic_id, unit, passed, score, timeSpentSeconds, assessment.type, correctAnswers]
      );
    }

    return {
      assessmentId,
      attemptNumber: attempt.attempt_number,
      submittedAt: attempt.submitted_at,
      score,
      correctAnswers,
      totalQuestions: assessment.totalQuestions,
      passed,
      percentage: score,
      detailedResults,
      competencyGaps: gaps,
      feedback: generateFeedback(score, assessment.passingScore, gaps)
    };
  } catch (error) {
    console.error('Assessment submission error:', error);
    throw error;
  }
}

/**
 * Identify competency gaps from assessment performance
 * @param {string} userId - Student ID
 * @param {string} assessmentId - Assessment ID
 * @param {Array} detailedResults - Scoring results from submitAssessment
 * @returns {Promise<Array>} Array of competency gaps
 */
export async function identifyCompetencyGaps(userId, assessmentId, detailedResults) {
  try {
    // Group questions by skill/topic
    const gapsBySkill = {};

    for (const result of detailedResults) {
      if (!result.isCorrect) {
        // Get question metadata to find skill
        try {
          const question = await db.one(
            `SELECT id, topic_id FROM question WHERE id = $1`,
            [result.questionId]
          );

          if (question) {
            if (!gapsBySkill[question.topic_id]) {
              gapsBySkill[question.topic_id] = { incorrect: 0, total: 0 };
            }
            gapsBySkill[question.topic_id].incorrect++;
            gapsBySkill[question.topic_id].total++;
          }
        } catch (e) {
          // Question not found, skip
        }
      }
    }

    // Create competency gap records
    const gaps = [];
    for (const [skillId, stats] of Object.entries(gapsBySkill)) {
      const severity = stats.incorrect / stats.total; // 0-1 scale

      if (severity >= 0.3) { // Only flag gaps where 30%+ wrong
        try {
          const gap = await db.one(
            `INSERT INTO competency_gaps
              (user_id, assessment_id, topic_id, skill_id, skill_name, gap_severity)
             VALUES ($1, $2, $3, $4, $4, $5)
             ON CONFLICT (user_id, assessment_id, skill_id) DO UPDATE SET
               gap_severity = $5,
               updated_at = NOW()
             RETURNING id, skill_id, skill_name, gap_severity`,
            [userId, assessmentId, skillId, skillId, severity]
          );

          gaps.push({
            skillId: gap.skill_id,
            skillName: gap.skill_name,
            severity: gap.gap_severity,
            severityPercent: Math.round(gap.gap_severity * 100)
          });
        } catch (e) {
          // Error creating gap, continue
        }
      }
    }

    return gaps;
  } catch (error) {
    console.error('Competency gap detection error:', error);
    return [];
  }
}

/**
 * Get student's assessment history
 * @param {string} userId - Student ID
 * @param {string} assessmentId - Optional specific assessment
 * @returns {Promise<Array>} Assessment attempts
 */
export async function getStudentAssessmentHistory(userId, assessmentId = null) {
  try {
    let query = `
      SELECT ua.id, ua.attempt_number, ua.submitted_at, ua.score,
             ua.correct_answers, ua.total_questions, ua.passed,
             ua.time_spent_seconds, uas.assessment_type, u.name as unit_name
      FROM student_assessment_attempts ua
      JOIN unit_assessments uas ON ua.assessment_id = uas.id
      JOIN unit u ON uas.unit_id = u.id
      WHERE ua.user_id = $1
    `;

    const params = [userId];

    if (assessmentId) {
      query += ` AND ua.assessment_id = $${params.length + 1}`;
      params.push(assessmentId);
    }

    query += ` ORDER BY ua.submitted_at DESC`;

    const attempts = await db.many(query, params);

    return attempts.map(a => ({
      id: a.id,
      attemptNumber: a.attempt_number,
      submittedAt: a.submitted_at,
      score: a.score,
      correctAnswers: a.correct_answers,
      totalQuestions: a.total_questions,
      passed: a.passed,
      timeSpentSeconds: a.time_spent_seconds,
      assessmentType: a.assessment_type,
      unitName: a.unit_name
    }));
  } catch (error) {
    console.error('Assessment history retrieval error:', error);
    throw error;
  }
}

/**
 * Get student's competency gaps
 * @param {string} userId - Student ID
 * @param {string} topicId - Optional filter by topic
 * @returns {Promise<Array>} Competency gaps
 */
export async function getStudentCompetencyGaps(userId, topicId = null) {
  try {
    let query = `
      SELECT id, skill_id, skill_name, gap_severity, identified_at,
             recommended_lesson_id, remediation_completed
      FROM competency_gaps
      WHERE user_id = $1 AND remediation_completed = FALSE
    `;

    const params = [userId];

    if (topicId) {
      query += ` AND topic_id = $${params.length + 1}`;
      params.push(topicId);
    }

    query += ` ORDER BY gap_severity DESC, identified_at DESC`;

    const gaps = await db.many(query, params);

    return gaps.map(g => ({
      id: g.id,
      skillId: g.skill_id,
      skillName: g.skill_name,
      severity: g.gap_severity,
      severityPercent: Math.round(g.gap_severity * 100),
      identifiedAt: g.identified_at,
      recommendedLessonId: g.recommended_lesson_id,
      remediationCompleted: g.remediation_completed
    }));
  } catch (error) {
    console.error('Competency gaps retrieval error:', error);
    throw error;
  }
}

/**
 * Get assessment analytics
 * @param {string} assessmentId - Assessment ID
 * @returns {Promise<Object>} Analytics data
 */
export async function getAssessmentAnalytics(assessmentId) {
  try {
    // Get or create analytics record
    let analytics = null;
    try {
      analytics = await db.one(
        `SELECT * FROM assessment_analytics WHERE assessment_id = $1`,
        [assessmentId]
      );
    } catch (e) {
      // Record doesn't exist
    }

    if (!analytics) {
      // Calculate from raw data
      const stats = await db.one(
        `SELECT
          COUNT(*) as total_submissions,
          COUNT(CASE WHEN passed THEN 1 END) as passed_count,
          AVG(score) as average_score,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score) as median_score,
          AVG(time_spent_seconds) as average_time,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_spent_seconds) as median_time
         FROM student_assessment_attempts
         WHERE assessment_id = $1 AND submitted_at IS NOT NULL`,
        [assessmentId]
      );

      const passRate = stats.total_submissions > 0
        ? (stats.passed_count / stats.total_submissions)
        : 0;

      return {
        assessmentId,
        totalSubmissions: stats.total_submissions || 0,
        averageScore: stats.average_score || 0,
        medianScore: stats.median_score || 0,
        passRate: Math.round(passRate * 100),
        averageTimeSeconds: Math.round(stats.average_time || 0),
        medianTimeSeconds: Math.round(stats.median_time || 0)
      };
    }

    return {
      assessmentId: analytics.assessment_id,
      totalSubmissions: analytics.total_submissions,
      averageScore: analytics.average_score,
      medianScore: analytics.median_score,
      passRate: Math.round(analytics.pass_rate * 100),
      averageTimeSeconds: analytics.average_time_seconds,
      medianTimeSeconds: analytics.median_time_seconds
    };
  } catch (error) {
    console.error('Assessment analytics error:', error);
    throw error;
  }
}

/**
 * Generate feedback message based on performance
 * @param {number} score - Score percentage (0-100)
 * @param {number} passingScore - Passing score (0-1)
 * @param {Array} gaps - Competency gaps
 * @returns {Object} Feedback with message and suggestions
 */
function generateFeedback(score, passingScore, gaps) {
  const passingPercent = passingScore * 100;
  let message = '';
  let suggestions = [];

  if (score >= passingPercent + 20) {
    message = 'Excellent! You demonstrated strong mastery of this material.';
    suggestions.push('You can move on to more advanced concepts.');
  } else if (score >= passingPercent) {
    message = 'Great! You passed this assessment.';
    suggestions.push('Review your incorrect answers to strengthen weak areas.');
  } else if (score >= passingPercent - 10) {
    message = 'Close! You were just short of passing.';
    suggestions.push('Review the recommended lessons for your identified gaps.');
    suggestions.push('Try again after reinforcing the weak concepts.');
  } else {
    message = 'This assessment revealed some areas for improvement.';
    suggestions.push('Complete the remedial lessons for your gaps.');
    suggestions.push('Practice with similar problems.');
    suggestions.push('Try again when you feel more confident.');
  }

  // Add gap-specific suggestions
  if (gaps && gaps.length > 0) {
    const topGap = gaps[0];
    suggestions.unshift(
      `Focus on ${topGap.skillName} - your weakest area (${topGap.severityPercent}% gap).`
    );
  }

  return {
    message,
    suggestions,
    score,
    passingPercent,
    passed: score >= passingPercent
  };
}

/**
 * Check if student can attempt assessment again
 * @param {string} assessmentId - Assessment ID
 * @param {string} userId - Student ID
 * @returns {Promise<Object>} {canAttempt, reason, attemptsRemaining}
 */
export async function canAttemptAssessment(assessmentId, userId) {
  try {
    const assessment = await db.one(
      `SELECT allow_multiple_attempts, max_attempts FROM unit_assessments WHERE id = $1`,
      [assessmentId]
    );

    if (!assessment.allow_multiple_attempts) {
      const hasAttempted = await db.one(
        `SELECT COUNT(*) as count FROM student_assessment_attempts
         WHERE assessment_id = $1 AND user_id = $2 AND submitted_at IS NOT NULL`,
        [assessmentId, userId]
      );

      if (hasAttempted.count > 0) {
        return {
          canAttempt: false,
          reason: 'This assessment allows only one attempt',
          attemptsRemaining: 0
        };
      }
    }

    if (assessment.max_attempts) {
      const attempts = await db.one(
        `SELECT COUNT(*) as count FROM student_assessment_attempts
         WHERE assessment_id = $1 AND user_id = $2 AND submitted_at IS NOT NULL`,
        [assessmentId, userId]
      );

      const remaining = assessment.max_attempts - attempts.count;
      if (remaining <= 0) {
        return {
          canAttempt: false,
          reason: `Maximum attempts (${assessment.max_attempts}) reached`,
          attemptsRemaining: 0
        };
      }

      return {
        canAttempt: true,
        reason: null,
        attemptsRemaining: remaining
      };
    }

    return {
      canAttempt: true,
      reason: null,
      attemptsRemaining: null
    };
  } catch (error) {
    console.error('Assessment attempt check error:', error);
    throw error;
  }
}

// ===========================================================================
// Phase 3: Lawlore Learning Platform - Competency Tracking Functions
// ===========================================================================

/**
 * Helper to get core_user_id from brand user_id
 * unified_student_progress uses core_user_id as foreign key
 */
async function getCoreUserId(brandUserId) {
  const user = await db.one(
    'SELECT core_user_id FROM users WHERE id = $1',
    [brandUserId]
  );
  return user?.core_user_id || brandUserId;
}

/**
 * Get law curriculum competency assessment for a student
 * @param {string} userId - Student user ID (brand user ID)
 * @returns {Promise<Object>} Competency level, units completed, gaps, etc.
 */
export async function getLawAssessment(userId) {
  const coreUserId = await getCoreUserId(userId);
  try {
    // Get all law units
    const allUnits = await db.many(
      `SELECT id, name, topic_id, teaches_topics
       FROM unit WHERE topic_id LIKE 'law:%'
       ORDER BY difficulty_level, unit_order`
    );

    // Get student's completed law units from unified_student_progress
    const completedUnits = await db.many(
      `SELECT DISTINCT usp.unit_id, u.topic_id, u.teaches_topics, usp.completed_at
       FROM unified_student_progress usp
       JOIN unit u ON usp.unit_id = u.id
       WHERE usp.user_id = $1 AND usp.status = 'completed' AND u.topic_id LIKE 'law:%'
       ORDER BY usp.completed_at DESC`,
      [coreUserId]
    );

    // Calculate topics breakdown
    const topicsMap = {};
    completedUnits.forEach(cu => {
      if (cu.teaches_topics && Array.isArray(cu.teaches_topics)) {
        cu.teaches_topics.forEach(topic => {
          topicsMap[topic] = (topicsMap[topic] || 0) + 1;
        });
      } else if (cu.topic_id) {
        topicsMap[cu.topic_id] = (topicsMap[cu.topic_id] || 0) + 1;
      }
    });

    // Determine competency level
    const completionRate = allUnits.length > 0 ? completedUnits.length / allUnits.length : 0;
    let competencyLevel = 'beginner';
    if (completionRate >= 0.8) competencyLevel = 'advanced';
    else if (completionRate >= 0.4) competencyLevel = 'intermediate';

    // Find competency gaps (topics not yet studied)
    const allTopics = ['law:criminal', 'law:constitutional', 'law:contract', 'law:procedure', 'law:evidence', 'law:property'];
    const studiedTopics = Object.keys(topicsMap);
    const competencyGaps = allTopics.filter(t => !studiedTopics.includes(t));

    // Get recommended next units
    const recommendedUnits = await getRecommendedNextUnits(coreUserId, 3);

    return {
      competency_level: competencyLevel,
      units_completed: completedUnits.length,
      units_total: allUnits.length,
      completion_rate: Math.round(completionRate * 100),
      topics_breakdown: topicsMap,
      competency_gaps: competencyGaps,
      recommended_units: recommendedUnits
    };
  } catch (error) {
    console.error('Get law assessment error:', error);
    throw error;
  }
}

/**
 * Update student assessment after completing a unit
 * @param {string} userId - Student user ID
 * @param {string} unitId - Completed unit ID
 * @returns {Promise<void>}
 */
export async function updateLawAssessmentAfterUnit(userId, unitId, brandId) {
  try {
    const { v4: uuidv4 } = await import('uuid');
    const coreUserId = await getCoreUserId(userId);

    // Get unit details
    const unit = await db.one(
      `SELECT topic_id, teaches_topics, brand_id FROM unit WHERE id = $1`,
      [unitId]
    );

    // Check if already recorded
    const existing = await db.one(
      `SELECT id FROM unified_student_progress
       WHERE user_id = $1 AND unit_id = $2`,
      [coreUserId, unitId]
    );

    if (existing) {
      // Update existing record
      await db.query(
        `UPDATE unified_student_progress
         SET status = 'completed', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [existing.id]
      );
    } else {
      // Insert new record
      await db.query(
        `INSERT INTO unified_student_progress
         (id, brand_id, user_id, app_code, topic_id, unit_id, status, completed_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'law', $4, $5, 'completed', NOW(), NOW(), NOW())`,
        [uuidv4(), brandId || unit.brand_id, coreUserId, unit.topic_id, unitId]
      );
    }
  } catch (error) {
    console.error('Update law assessment error:', error);
    throw error;
  }
}

/**
 * Get recommended next units for student based on progress
 * @param {string} userId - Student user ID
 * @param {number} limit - Max number of recommendations
 * @returns {Promise<Array>} Recommended units with reasons
 */
export async function getRecommendedNextUnits(userId, limit = 5) {
  try {
    // Get completed units
    const completed = await db.many(
      `SELECT usp.unit_id
       FROM unified_student_progress usp
       JOIN unit u ON usp.unit_id = u.id
       WHERE usp.user_id = $1 AND usp.status = 'completed' AND u.topic_id LIKE 'law:%'`,
      [userId]
    );

    const completedIds = completed.map(c => c.unit_id);

    // Get next units (not completed, ordered by difficulty)
    const recommended = await db.many(
      `SELECT id, name, difficulty_level, topic_id, teaches_topics
       FROM unit
       WHERE topic_id LIKE 'law:%'
       ${completedIds.length > 0 ? `AND id NOT IN (${completedIds.map((_, i) => `$${i + 2}`).join(',')})` : ''}
       ORDER BY difficulty_level ASC, unit_order ASC
       LIMIT $1`,
      [limit, ...completedIds]
    );

    return recommended.map(u => ({
      unit_id: u.id,
      unit_name: u.name,
      topic_id: u.topic_id,
      difficulty: u.difficulty_level,
      reason: completedIds.length === 0
        ? 'Start here - foundational unit'
        : 'Next in sequence',
      estimated_time: '45-60 min'
    }));
  } catch (error) {
    console.error('Get recommended units error:', error);
    throw error;
  }
}

/**
 * Get topic mastery percentages for student
 * @param {string} userId - Student user ID
 * @returns {Promise<Array>} Topic mastery data
 */
export async function getTopicMastery(userId) {
  try {
    const coreUserId = await getCoreUserId(userId);
    const topics = ['law:criminal', 'law:constitutional', 'law:contract', 'law:procedure', 'law:evidence', 'law:property'];
    const topicNames = {
      'law:criminal': 'Criminal Law',
      'law:constitutional': 'Constitutional Law',
      'law:contract': 'Contract Law',
      'law:procedure': 'Civil Procedure',
      'law:evidence': 'Evidence Law',
      'law:property': 'Property Law'
    };

    const mastery = [];

    for (const topicId of topics) {
      // Get total units for this topic
      const totalUnits = await db.one(
        `SELECT COUNT(*) as count FROM unit WHERE topic_id = $1`,
        [topicId]
      );

      // Get completed units for this topic
      const completedUnits = await db.one(
        `SELECT COUNT(DISTINCT usp.unit_id) as count
         FROM unified_student_progress usp
         JOIN unit u ON usp.unit_id = u.id
         WHERE usp.user_id = $1 AND usp.status = 'completed'
         AND u.topic_id = $2`,
        [coreUserId, topicId]
      );

      const masteryPct = totalUnits.count > 0
        ? Math.round((completedUnits.count / totalUnits.count) * 100)
        : 0;

      mastery.push({
        topic_id: topicId,
        topic_name: topicNames[topicId],
        mastery_percentage: masteryPct,
        units_completed: parseInt(completedUnits.count),
        units_total: parseInt(totalUnits.count)
      });
    }

    return mastery;
  } catch (error) {
    console.error('Get topic mastery error:', error);
    throw error;
  }
}

/**
 * Get law learning statistics for student
 * @param {string} userId - Student user ID
 * @returns {Promise<Object>} Learning stats
 */
export async function getLawLearningStats(userId) {
  try {
    const coreUserId = await getCoreUserId(userId);

    // Get all law units count
    const totalUnits = await db.one(
      `SELECT COUNT(*) as count FROM unit WHERE topic_id LIKE 'law:%'`
    );

    // Get completed units
    const completedUnits = await db.one(
      `SELECT COUNT(DISTINCT usp.unit_id) as count
       FROM unified_student_progress usp
       JOIN unit u ON usp.unit_id = u.id
       WHERE usp.user_id = $1 AND usp.status = 'completed' AND u.topic_id LIKE 'law:%'`,
      [coreUserId]
    );

    // Get in-progress units (started but not completed)
    const inProgressUnits = await db.one(
      `SELECT COUNT(DISTINCT usp.unit_id) as count
       FROM unified_student_progress usp
       JOIN unit u ON usp.unit_id = u.id
       WHERE usp.user_id = $1 AND usp.status = 'in_progress' AND u.topic_id LIKE 'law:%'`,
      [coreUserId]
    );

    // Calculate average score (if we had scores stored)
    const avgScore = 0; // Placeholder - would calculate from assessment scores

    // Calculate hours spent (estimate based on units completed)
    const hoursSpent = completedUnits.count * 1; // Estimate 1 hour per unit

    return {
      total_units: parseInt(totalUnits.count),
      completed_units: parseInt(completedUnits.count),
      in_progress_units: parseInt(inProgressUnits.count),
      completion_rate: totalUnits.count > 0
        ? Math.round((completedUnits.count / totalUnits.count) * 100)
        : 0,
      hours_spent: hoursSpent,
      average_score: avgScore
    };
  } catch (error) {
    console.error('Get law learning stats error:', error);
    throw error;
  }
}
