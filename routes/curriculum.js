import express from 'express';
import db from '../db.js';
import { brandResolver } from '../middleware/brandResolver.js';

const router = express.Router();

// Apply brand resolver to all curriculum routes
router.use(brandResolver);

/**
 * GET /curriculum/languages
 * Get all available languages with question counts
 */
router.get('/languages', async (req, res) => {
  try {
    const languages = await db.many(
      `
        SELECT
          t.language,
          COUNT(DISTINCT t.id) as topic_count,
          COUNT(q.id) as question_count
        FROM topic t
        LEFT JOIN question q ON q.topic_id = t.id AND q.brand_id = $1
        WHERE t.brand_id = $1
        GROUP BY t.language
        ORDER BY question_count DESC
      `,
      [req.brandId]
    );

    res.json(languages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /curriculum/:language/topics
 * Get all topics for a language
 */
router.get('/:language/topics', async (req, res) => {
  try {
    const { language } = req.params;

    const topics = await db.many(
      `
        SELECT
          id,
          name,
          parent_id as "parentId",
          language,
          curriculum_id as "curriculumId"
        FROM topic
        WHERE language = $1 AND brand_id = $2
        ORDER BY name
      `,
      [language, req.brandId]
    );

    res.json(topics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /curriculum/:language/topics/:topicId
 * Get a specific topic with its questions
 */
router.get('/:language/topics/:topicId', async (req, res) => {
  try {
    const { language, topicId } = req.params;

    const topic = await db.one(
      `
        SELECT
          id,
          name,
          parent_id as "parentId",
          language,
          curriculum_id as "curriculumId"
        FROM topic
        WHERE id = $1 AND language = $2 AND brand_id = $3
      `,
      [topicId, language, req.brandId]
    );

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const questions = await db.many(
      `
        SELECT
          id,
          prompt,
          type,
          correct_answer as "correctAnswer",
          metadata
        FROM question
        WHERE topic_id = $1 AND language = $2 AND brand_id = $3
        LIMIT 100
      `,
      [topicId, language, req.brandId]
    );

    res.json({ topic, questions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /curriculum/:language/questions/random
 * Get random question(s) for a language, optionally filtered by topic or difficulty
 */
router.get('/:language/questions/random', async (req, res) => {
  try {
    const { language } = req.params;
    const { count = 1, topicId, difficulty } = req.query;

    let query = 'SELECT * FROM question WHERE language = $1 AND brand_id = $2';
    const params = [language, req.brandId];
    let idx = 3;

    if (topicId) {
      query += ` AND topic_id = $${idx++}`;
      params.push(topicId);
    }

    if (difficulty) {
      query += ` AND (metadata->>'difficulty') = $${idx++}`;
      params.push(difficulty);
    }

    query += ` ORDER BY random() LIMIT $${idx++}`;
    params.push(parseInt(count, 10));

    const questions = await db.many(query, params);

    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /curriculum/:language/statistics
 * Get statistics for a language's curriculum
 */
router.get('/:language/statistics', async (req, res) => {
  try {
    const { language } = req.params;

    const stats = await db.one(
      `
        SELECT
          $1 as language,
          COUNT(DISTINCT t.id) as total_topics,
          COUNT(DISTINCT c.id) as curriculum_statements,
          COUNT(q.id) as total_questions,
          COALESCE(SUM(CASE WHEN q.type = 'mcq' THEN 1 ELSE 0 END), 0) as mcq_count,
          COALESCE(SUM(CASE WHEN q.type = 'fill' THEN 1 ELSE 0 END), 0) as fill_count
        FROM topic t
        LEFT JOIN curriculum_statements c ON t.curriculum_id = c.id AND c.brand_id = $2
        LEFT JOIN question q ON q.topic_id = t.id AND q.brand_id = $2
        WHERE t.language = $1 AND t.brand_id = $2
      `,
      [language, req.brandId]
    );

    res.json(
      stats || {
        language,
        total_topics: 0,
        curriculum_statements: 0,
        total_questions: 0,
        mcq_count: 0,
        fill_count: 0,
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /curriculum/:language/topics/hierarchy
 * Get hierarchical topic structure for a language
 */
router.get('/:language/hierarchy', async (req, res) => {
  try {
    const { language } = req.params;

    const topics = await db.many(
      `
        SELECT
          id,
          name,
          parent_id as "parentId",
          language
        FROM topic
        WHERE language = $1 AND brand_id = $2
        ORDER BY parent_id, name
      `,
      [language, req.brandId]
    );

    // Build hierarchy
    const buildHierarchy = (parentId = null, depth = 0) => {
      return topics
        .filter(t => t.parentId === parentId)
        .map(t => ({
          ...t,
          children: buildHierarchy(t.id, depth + 1)
        }));
    };

    const hierarchy = buildHierarchy();

    res.json(hierarchy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
