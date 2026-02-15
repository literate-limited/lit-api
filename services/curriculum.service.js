import db from '../db.js';

/**
 * Compute ordered array of next units for a student
 * Based on identified competency gaps and pedagogical sequencing
 *
 * This is the core adaptive learning engine
 */
export async function computeNextUnits(userId, language) {
  try {
    // 1. Get student's current assessment
    const assessment = await db.one(
      `
        SELECT * FROM student_assessment
        WHERE user_id = $1 AND language = $2
        ORDER BY assessed_at DESC
        LIMIT 1
      `,
      [userId, language]
    );

    if (!assessment) {
      console.log(`No assessment yet for user ${userId}, returning foundational units`);
      return await getFoundationalUnits(language);
    }

    // 2. Get already completed units
    const completedUnits = await db.many(
      `
        SELECT DISTINCT unit_id FROM unit_assignment
        WHERE user_id = $1 AND status = 'completed'
      `,
      [userId]
    );
    const completedUnitIds = new Set(completedUnits.map(u => u.unit_id));

    // 3. Find all units that teach the competency gaps
    const gapTopics = Array.isArray(assessment.competency_gaps) ? assessment.competency_gaps : [];
    console.log(`Student has gaps in: ${gapTopics.join(', ')}`);

    let candidateUnits = [];
    if (gapTopics.length > 0) {
      const completed = completedUnitIds.size > 0 ? Array.from(completedUnitIds) : null;
      candidateUnits = await db.many(
        `
          SELECT DISTINCT u.* FROM unit u
          WHERE u.language = $1
            AND ($2::uuid[] IS NULL OR NOT (u.id = ANY($2::uuid[])))
            AND u.teaches_topics && $3::text[]
          ORDER BY u.difficulty_level, u.unit_order
        `,
        [language, completed, gapTopics]
      );
    }

    // 4. If no gaps identified yet, offer foundational units
    if (candidateUnits.length === 0) {
      console.log('No gaps identified, offering foundational units');
      return await getFoundationalUnits(language, Array.from(completedUnitIds));
    }

    // 5. Sort by pedagogical sequence
    const sorted = await sortPedagogically(candidateUnits, userId, language);

    console.log(`Next units for ${userId}: ${sorted.map(u => u.name).join(' → ')}`);
    return sorted;

  } catch (error) {
    console.error('Error computing next units:', error);
    throw error;
  }
}

/**
 * Sort units by pedagogical prerequisites and sequencing
 */
async function sortPedagogically(units, userId, language) {
  if (units.length === 0) return [];

  // Get prerequisite relationships between these units
  const prerequisites = await db.many(
    `
      SELECT child_topic_id, parent_topic_id, priority
      FROM topic_hierarchy
      WHERE relationship_type = 'prerequisite'
      ORDER BY priority
    `
  );

  // Get completed units to check if prerequisites are met
  const completedTopics = await db.many(
    `
      SELECT DISTINCT u.teaches_topics
      FROM unit_assignment ua
      JOIN unit u ON ua.unit_id = u.id
      WHERE ua.user_id = $1 AND ua.status = 'completed'
    `,
    [userId]
  );

  const completedTopicSet = new Set();
  completedTopics.forEach(row => {
    if (row.teaches_topics) {
      row.teaches_topics.forEach(topic => completedTopicSet.add(topic));
    }
  });

  // Topological sort: units with satisfied prerequisites first
  const scored = units.map(unit => {
    let score = 0;

    // Higher score = should come later
    if (unit.teaches_topics) {
      unit.teaches_topics.forEach(topic => {
        // Find if this topic has unsatisfied prerequisites
        const hasPrereq = prerequisites.some(p =>
          p.child_topic_id === topic && !completedTopicSet.has(p.parent_topic_id)
        );

        if (hasPrereq) {
          score += 10; // Penalize if prerequisites not met
        }
      });
    }

    return { ...unit, score };
  });

  // Sort: lower score (ready to do) first
  return scored.sort((a, b) => a.score - b.score);
}

/**
 * Get foundational units when no assessment exists yet
 */
async function getFoundationalUnits(language, excludeUnitIds = []) {
  const exclude = excludeUnitIds.length > 0 ? excludeUnitIds : null;
  const units = await db.many(
    `
      SELECT * FROM unit
      WHERE language = $1
        AND ($2::uuid[] IS NULL OR NOT (id = ANY($2::uuid[])))
        AND difficulty_level IN ('F-2', '3-4', '5-6')
      ORDER BY difficulty_level, unit_order
      LIMIT 5
    `,
    [language, exclude]
  );
  return units;
}

/**
 * Get a specific unit with all its levels
 */
export async function getUnitWithLevels(unitId) {
  const unit = await db.one('SELECT * FROM unit WHERE id = $1', [unitId]);
  if (!unit) return null;

  const levels = await db.many(
    `
      SELECT * FROM level
      WHERE unit_id = $1
      ORDER BY level_order
    `,
    [unitId]
  );

  return { ...unit, levels };
}

/**
 * Mark a lesson level as completed
 */
export async function completeLessonLevel(userId, levelId) {
  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();

  const row = await db.one(
    `
      INSERT INTO level_progress (id, user_id, level_id, completed_at, attempt_number)
      VALUES ($1, $2, $3, NOW(), 1)
      ON CONFLICT (user_id, level_id, attempt_number)
      DO UPDATE SET completed_at = NOW()
      RETURNING *
    `,
    [id, userId, levelId]
  );
  return row;
}

/**
 * Submit an answer to a question level
 */
export async function submitAnswer(userId, levelId, userAnswer) {
  const level = await db.one('SELECT * FROM level WHERE id = $1', [levelId]);
  if (!level) throw new Error('Level not found');

  let isCorrect = false;
  if (level.type === 'question') {
    if (level.question_type === 'mcq') {
      isCorrect = parseInt(userAnswer, 10) === parseInt(level.correct_answer, 10);
    } else if (level.question_type === 'fill') {
      isCorrect =
        String(userAnswer).toLowerCase().trim() ===
        String(level.correct_answer).toLowerCase().trim();
    }
  }

  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();

  const result = await db.one(
    `
      INSERT INTO level_progress
        (id, user_id, level_id, completed_at, user_answer, is_correct, attempt_number)
      VALUES ($1,$2,$3,NOW(),$4,$5,1)
      ON CONFLICT (user_id, level_id, attempt_number)
      DO UPDATE SET
        completed_at = NOW(),
        user_answer = EXCLUDED.user_answer,
        is_correct = EXCLUDED.is_correct
      RETURNING *
    `,
    [id, userId, levelId, String(userAnswer), isCorrect]
  );

  return { correct: isCorrect, correctAnswer: level.correct_answer, result };
}

/**
 * Assign a unit to a student
 */
export async function assignUnit(userId, unitId, assignedBy = 'ai', reason = '') {
  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();

  const inserted = await db.one(
    `
      INSERT INTO unit_assignment (id, user_id, unit_id, assigned_by, assignment_reason, status)
      VALUES ($1,$2,$3,$4,$5,'pending')
      ON CONFLICT (user_id, unit_id) DO NOTHING
      RETURNING *
    `,
    [id, userId, unitId, assignedBy, reason]
  );

  if (inserted) return inserted;
  return db.one(
    `SELECT * FROM unit_assignment WHERE user_id = $1 AND unit_id = $2`,
    [userId, unitId]
  );
}

/**
 * Update student assessment based on chat analysis
 */
export async function updateStudentAssessment(userId, language, assessment) {
  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();

  const gaps = Array.isArray(assessment.competencyGaps)
    ? assessment.competencyGaps
    : [];

  const row = await db.one(
    `
      INSERT INTO student_assessment
        (id, user_id, language, current_level, target_language_pct, fluency_score, error_rate, confidence_level, competency_gaps)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (user_id, language)
      DO UPDATE SET
        current_level = EXCLUDED.current_level,
        target_language_pct = EXCLUDED.target_language_pct,
        fluency_score = EXCLUDED.fluency_score,
        error_rate = EXCLUDED.error_rate,
        confidence_level = EXCLUDED.confidence_level,
        competency_gaps = EXCLUDED.competency_gaps,
        assessed_at = NOW()
      RETURNING *
    `,
    [
      id,
      userId,
      language,
      assessment.currentLevel || null,
      assessment.targetLanguagePct || 0,
      assessment.fluencyScore || 0,
      assessment.errorRate || 1,
      assessment.confidenceLevel || null,
      gaps,
    ]
  );

  return row;
}

export default {
  computeNextUnits,
  getUnitWithLevels,
  completeLessonLevel,
  submitAnswer,
  assignUnit,
  updateStudentAssessment
};
