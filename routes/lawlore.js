import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { verifyToken, optionalAuth } from '../middleware/auth.js';
import { auditLog, logAccessDenial } from '../middleware/lawAudit.js';
import { requireConsultationAccess, getUserConsultations } from '../middleware/lawAccessControl.js';
import {
  searchLaw,
  getStatute,
  getCase,
  getStatuteCitations,
  getCaseCitations
} from '../services/law-search.service.js';
import { encryptField, decryptField, decryptRow, isEncryptionConfigured } from '../services/law-encryption.service.js';
import { generateLegalResponse } from '../services/law-claude.service.js';
import { ingestCommonwealthLegislation } from '../services/law-commonwealth-ingest.service.js';
import { ingestHighCourtCases } from '../services/law-hca-ingest.service.js';
import { ingestEmploymentLaw } from '../services/law-employment-ingest.service.js';
import { ingestEmploymentCases } from '../services/law-employment-cases-ingest.service.js';
import {
  embedEmploymentStatutes,
  embedEmploymentCases,
  semanticSearchStatutes,
  semanticSearchCases,
  semanticSearchAll,
  getEmbeddingStats
} from '../services/law-embeddings.service.js';
import {
  getLessonWithMetadata,
  getUnitLessons,
  getLessonsByDifficulty,
  getPrerequisiteChain,
  checkPrerequisiteCompletion,
  getLessonsByTags,
  getRecommendedNextLesson,
  updateLessonMetadata,
  getUnitLessonStats,
  trackLessonView
} from '../services/law-lesson.service.js';
import {
  getAssessment,
  getUnitAssessments,
  submitAssessment,
  identifyCompetencyGaps,
  getStudentAssessmentHistory,
  getStudentCompetencyGaps,
  getAssessmentAnalytics,
  canAttemptAssessment,
  getLawAssessment,
  updateLawAssessmentAfterUnit,
  getRecommendedNextUnits,
  getTopicMastery,
  getLawLearningStats
} from '../services/law-assessment.service.js';

const router = Router();

router.use(brandResolver);

// ---------------------------------------------------------------------------
// Public Search Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/law/search
 * Public search across statutes and cases
 * Query params: q, type (statute|case|all), jurisdiction, year_from, year_to, limit, offset
 */
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const {
      q: query,
      type = 'all',
      jurisdiction = null,
      year_from: yearFrom,
      year_to: yearTo,
      limit = 50,
      offset = 0
    } = req.query;

    // Log search history
    if (req.user || query) {
      const resultCount = 0; // Will be updated after search
      await db.query(
        `INSERT INTO law_search_history (brand_id, user_id, query, filters, result_count, search_type)
         VALUES ($1, $2, $3, $4, $5, 'search')`,
        [
          req.brandId,
          req.user?.userId || null,
          query || '',
          JSON.stringify({
            type,
            jurisdiction,
            yearFrom,
            yearTo
          }),
          0
        ]
      );
    }

    const results = await searchLaw(req.brandId, {
      query,
      type: type === 'all' ? 'all' : type,
      jurisdiction: jurisdiction ? String(jurisdiction) : null,
      yearFrom: yearFrom ? parseInt(yearFrom) : null,
      yearTo: yearTo ? parseInt(yearTo) : null,
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0
    });

    return res.json(results);
  } catch (error) {
    console.error('Law search error:', error);
    return res.status(500).json({
      error: 'SEARCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/statutes/:id
 * Retrieve full statute details
 */
router.get('/statutes/:id', optionalAuth, async (req, res) => {
  try {
    const statute = await getStatute(req.brandId, req.params.id);

    if (!statute) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json(statute);
  } catch (error) {
    console.error('Get statute error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/cases/:id
 * Retrieve full case details
 */
router.get('/cases/:id', optionalAuth, async (req, res) => {
  try {
    const caseDetails = await getCase(req.brandId, req.params.id);

    if (!caseDetails) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json(caseDetails);
  } catch (error) {
    console.error('Get case error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/citations/:id
 * Get documents citing or cited by a statute/case
 * Query params: type (statute|case), citing (true|false - default true for citing this doc)
 */
router.get('/citations/:id', optionalAuth, async (req, res) => {
  try {
    const { type = 'statute', citing = 'true', limit = 50, offset = 0 } = req.query;
    const isCiting = citing === 'true';

    let citations = [];

    if (type === 'statute') {
      citations = await getStatuteCitations(
        req.brandId,
        req.params.id,
        parseInt(limit),
        parseInt(offset)
      );
    } else if (type === 'case') {
      citations = await getCaseCitations(
        req.brandId,
        req.params.id,
        parseInt(limit),
        parseInt(offset)
      );
    }

    return res.json({
      citing: isCiting,
      documentType: type,
      citations,
      total: citations.length
    });
  } catch (error) {
    console.error('Get citations error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

// ---------------------------------------------------------------------------
// User Features (Authenticated)
// ---------------------------------------------------------------------------

/**
 * POST /api/law/saved-searches
 * Save a search query
 */
router.post('/saved-searches', verifyToken, async (req, res) => {
  try {
    const { name, query, filters } = req.body;

    if (!name || !query) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'name and query are required'
      });
    }

    const savedSearch = await db.one(
      `INSERT INTO law_saved_searches
        (id, brand_id, user_id, name, query, filters, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, name, query, filters, created_at, updated_at`,
      [
        uuidv4(),
        req.brandId,
        req.user.userId,
        name,
        query,
        JSON.stringify(filters || {})
      ]
    );

    return res.status(201).json(savedSearch);
  } catch (error) {
    console.error('Save search error:', error);
    return res.status(500).json({
      error: 'SAVE_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/saved-searches
 * List user's saved searches
 */
router.get('/saved-searches', verifyToken, async (req, res) => {
  try {
    const searches = await db.many(
      `SELECT id, name, query, filters, result_count, last_run, created_at, updated_at
       FROM law_saved_searches
       WHERE brand_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [req.brandId, req.user.userId]
    );

    return res.json({
      searches: searches.map(s => ({
        id: s.id,
        name: s.name,
        query: s.query,
        filters: typeof s.filters === 'string' ? JSON.parse(s.filters) : s.filters,
        resultCount: s.result_count,
        lastRun: s.last_run,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      }))
    });
  } catch (error) {
    console.error('List saved searches error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/saved-searches/:id
 * Get a saved search and re-run it
 */
router.get('/saved-searches/:id', verifyToken, async (req, res) => {
  try {
    const savedSearch = await db.one(
      `SELECT id, name, query, filters, result_count, last_run, created_at, updated_at
       FROM law_saved_searches
       WHERE id = $1 AND brand_id = $2 AND user_id = $3`,
      [req.params.id, req.brandId, req.user.userId]
    );

    if (!savedSearch) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const filters = typeof savedSearch.filters === 'string'
      ? JSON.parse(savedSearch.filters)
      : savedSearch.filters;

    // Re-run search with saved parameters
    const results = await searchLaw(req.brandId, {
      query: savedSearch.query,
      type: filters.type || 'all',
      jurisdiction: filters.jurisdiction || null,
      yearFrom: filters.yearFrom || null,
      yearTo: filters.yearTo || null,
      limit: Math.min(parseInt(filters.limit) || 50, 100),
      offset: 0
    });

    // Update last_run timestamp
    await db.query(
      `UPDATE law_saved_searches SET last_run = NOW(), result_count = $1 WHERE id = $2`,
      [results.total, req.params.id]
    );

    return res.json({
      savedSearch: {
        id: savedSearch.id,
        name: savedSearch.name,
        query: savedSearch.query,
        filters,
        createdAt: savedSearch.created_at
      },
      results: results.results,
      total: results.total,
      facets: results.facets
    });
  } catch (error) {
    console.error('Get saved search error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * DELETE /api/law/saved-searches/:id
 * Delete a saved search
 */
router.delete('/saved-searches/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM law_saved_searches
       WHERE id = $1 AND brand_id = $2 AND user_id = $3`,
      [req.params.id, req.brandId, req.user.userId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete saved search error:', error);
    return res.status(500).json({
      error: 'DELETE_ERROR',
      message: error.message
    });
  }
});

// ---------------------------------------------------------------------------
// Admin Ingestion Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/law/ingestion-status
 * Show sync job status (public)
 */
router.get('/ingestion-status', optionalAuth, async (req, res) => {
  try {
    const latestLogs = await db.many(
      `SELECT
        ls.id, ls.code, ls.name, ls.source_type,
        ril.status, ril.documents_processed, ril.documents_created,
        ril.documents_updated, ril.error_message,
        ril.started_at, ril.completed_at, ril.duration_seconds
       FROM law_sources ls
       LEFT JOIN LATERAL (
         SELECT * FROM law_ingestion_log
         WHERE source_id = ls.id
         ORDER BY completed_at DESC NULLS LAST
         LIMIT 1
       ) ril ON true
       WHERE ls.brand_id = $1
       ORDER BY ls.code ASC`,
      [req.brandId]
    );

    return res.json({
      sources: latestLogs.map(log => ({
        sourceId: log.id,
        code: log.code,
        name: log.name,
        sourceType: log.source_type,
        lastSync: {
          status: log.status || 'never',
          documentsProcessed: log.documents_processed,
          documentsCreated: log.documents_created,
          documentsUpdated: log.documents_updated,
          errorMessage: log.error_message,
          startedAt: log.started_at,
          completedAt: log.completed_at,
          durationSeconds: log.duration_seconds
        }
      }))
    });
  } catch (error) {
    console.error('Ingestion status error:', error);
    return res.status(500).json({
      error: 'STATUS_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/ingest/commonwealth
 * Trigger Commonwealth legislation sync (admin only)
 */
router.post('/ingest/commonwealth', verifyToken, async (req, res) => {
  try {
    const { limit = 100, startYear = 1990, updateOnly = false } = req.body;

    console.log('Starting Commonwealth legislation ingest...');
    const result = await ingestCommonwealthLegislation(req.brandId, {
      limit,
      startYear,
      updateOnly
    });

    return res.status(200).json({
      success: true,
      created: result.created,
      updated: result.updated,
      total: result.created + result.updated,
      message: `Ingestion complete: ${result.created} statutes created, ${result.updated} updated`
    });
  } catch (error) {
    console.error('Commonwealth ingest error:', error);
    return res.status(500).json({
      error: 'INGEST_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/ingest/hca
 * Trigger High Court case sync (admin only)
 */
router.post('/ingest/hca', verifyToken, async (req, res) => {
  try {
    const { limit = 50, years = [2023, 2022, 2021], updateOnly = false } = req.body;

    console.log('Starting High Court case ingest...');
    const result = await ingestHighCourtCases(req.brandId, {
      limit,
      years,
      updateOnly
    });

    return res.status(200).json({
      success: true,
      created: result.created,
      updated: result.updated,
      total: result.created + result.updated,
      message: `Ingestion complete: ${result.created} cases created, ${result.updated} updated`
    });
  } catch (error) {
    console.error('HCA ingest error:', error);
    return res.status(500).json({
      error: 'INGEST_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/ingest/employment
 * Trigger employment law statute sync (Fair Work Act, awards, discrimination laws)
 */
router.post('/ingest/employment', verifyToken, async (req, res) => {
  try {
    const { limit = 50, includeAwards = true, updateOnly = false } = req.body;

    console.log('Starting employment law ingest...');
    const result = await ingestEmploymentLaw(req.brandId, {
      limit,
      includeAwards,
      updateOnly
    });

    return res.status(200).json({
      success: true,
      created: result.created,
      updated: result.updated,
      total: result.created + result.updated,
      message: `Employment law ingestion complete: ${result.created} documents created, ${result.updated} updated`
    });
  } catch (error) {
    console.error('Employment law ingest error:', error);
    return res.status(500).json({
      error: 'INGEST_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/ingest/employment-cases
 * Trigger employment law case law sync (Federal Court, Fair Work Commission)
 */
router.post('/ingest/employment-cases', verifyToken, async (req, res) => {
  try {
    const { limit = 30, years = [2024, 2023, 2022], includeAgency = true, updateOnly = false } = req.body;

    console.log('Starting employment law cases ingest...');
    const result = await ingestEmploymentCases(req.brandId, {
      limit,
      years,
      includeAgency,
      updateOnly
    });

    return res.status(200).json({
      success: true,
      created: result.created,
      updated: result.updated,
      total: result.created + result.updated,
      message: `Employment law cases ingestion complete: ${result.created} cases created, ${result.updated} updated`
    });
  } catch (error) {
    console.error('Employment law cases ingest error:', error);
    return res.status(500).json({
      error: 'INGEST_ERROR',
      message: error.message
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 3: Learning Platform Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/law/curriculum
 * Get law curriculum structure (topics and units)
 * Public endpoint - no auth required
 */
router.get('/curriculum', optionalAuth, async (req, res) => {
  try {
    const topics = await db.many(
      `SELECT id, name, language, brand_id
       FROM topic
       WHERE id LIKE 'law:%'
       ORDER BY id`
    );

    const curriculum = [];

    for (const topic of topics) {
      const units = await db.many(
        `SELECT id, name, difficulty_level, unit_order, teaches_topics
         FROM unit
         WHERE topic_id = $1
         ORDER BY unit_order`,
        [topic.id]
      );

      curriculum.push({
        ...topic,
        units: units || []
      });
    }

    return res.json({
      topics: curriculum,
      totalTopics: curriculum.length,
      totalUnits: curriculum.reduce((sum, t) => sum + (t.units?.length || 0), 0)
    });
  } catch (error) {
    console.error('Curriculum fetch error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/units
 * Get all law units with lesson counts
 * Public endpoint - no auth required
 */
router.get('/units', optionalAuth, async (req, res) => {
  try {
    const units = await db.many(
      `SELECT u.id, u.name, u.difficulty_level,
              u.topic_id, t.name as topic_name,
              COUNT(l.id) as lesson_count
       FROM unit u
       LEFT JOIN topic t ON u.topic_id = t.id
       LEFT JOIN level l ON u.id = l.unit_id
       WHERE u.topic_id LIKE 'law:%'
       GROUP BY u.id, u.topic_id, t.name, u.difficulty_level, u.unit_order
       ORDER BY u.difficulty_level, u.unit_order`
    );

    return res.json({
      units: units || [],
      total: units?.length || 0
    });
  } catch (error) {
    console.error('Units fetch error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/units/:unitId
 * Get unit with all its lessons/levels
 * Public endpoint - no auth required
 */
router.get('/units/:unitId', optionalAuth, async (req, res) => {
  try {
    const unit = await db.one(
      `SELECT * FROM unit WHERE id = $1`,
      [req.params.unitId]
    );

    if (!unit) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const lessons = await db.many(
      `SELECT id, type, content, level_order
       FROM level
       WHERE unit_id = $1
       ORDER BY level_order`,
      [req.params.unitId]
    );

    return res.json({
      unit: unit,
      lessons: lessons || []
    });
  } catch (error) {
    console.error('Get unit error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/lessons/:levelId
 * Get a single lesson/quiz content
 * Public endpoint - no auth required
 */
router.get('/lessons/:levelId', optionalAuth, async (req, res) => {
  try {
    const lesson = await db.one(
      `SELECT id, type, content, level_order, unit_id
       FROM level WHERE id = $1`,
      [req.params.levelId]
    );

    if (!lesson) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    // If it's a question level, also fetch associated questions for that unit's topic
    let questions = [];
    if (lesson.type === 'question') {
      questions = await db.many(
        `SELECT q.id, q.prompt, q.type, q.correct_answer, q.explanation
         FROM question q
         WHERE q.topic_id IN (
           SELECT topic_id FROM unit WHERE id = $1
         )
         LIMIT 10`,
        [lesson.unit_id]
      );
    }

    return res.json({
      lesson: lesson,
      questions: questions || []
    });
  } catch (error) {
    console.error('Get lesson error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

// ---------------------------------------------------------------------------
// Enhanced Lesson Endpoints (Phase 2)
// ---------------------------------------------------------------------------

/**
 * GET /api/law/lessons/:levelId/full
 * Get lesson with all metadata, objectives, and prerequisites
 * Enhanced version with complete lesson information
 */
router.get('/lessons/:levelId/full', optionalAuth, async (req, res) => {
  try {
    const lesson = await getLessonWithMetadata(req.params.levelId);

    return res.json({
      success: true,
      lesson: {
        id: lesson.id,
        unitId: lesson.unitId,
        unitName: lesson.unitName,
        topicId: lesson.topicId,
        type: lesson.type,
        content: lesson.content,
        levelOrder: lesson.levelOrder,
        objectives: lesson.objectives,
        learningOutcomes: lesson.learningOutcomes,
        estimatedTimeMinutes: lesson.estimatedTimeMinutes,
        difficultyLevel: lesson.difficultyLevel,
        contentType: lesson.contentType,
        semanticTags: lesson.semanticTags,
        isActive: lesson.isActive,
        prerequisite: lesson.prerequisiteLesson
      }
    });
  } catch (error) {
    console.error('Get full lesson error:', error);
    return res.status(error.message === 'Lesson not found' ? 404 : 500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/units/:unitId/lessons
 * Get all lessons in a unit with metadata
 */
router.get('/units/:unitId/lessons', optionalAuth, async (req, res) => {
  try {
    const lessons = await getUnitLessons(req.params.unitId);

    return res.json({
      success: true,
      unitId: req.params.unitId,
      lessons: lessons,
      total: lessons.length
    });
  } catch (error) {
    console.error('Get unit lessons error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/lessons/prerequisites/:levelId
 * Get the prerequisite chain for a lesson
 */
router.get('/lessons/prerequisites/:levelId', optionalAuth, async (req, res) => {
  try {
    const chain = await getPrerequisiteChain(req.params.levelId);

    return res.json({
      success: true,
      levelId: req.params.levelId,
      prerequisiteChain: chain,
      chainLength: chain.length
    });
  } catch (error) {
    console.error('Get prerequisite chain error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/lessons/check-prerequisite/:levelId
 * Check if authenticated student has completed prerequisites
 */
router.get('/lessons/check-prerequisite/:levelId', verifyToken, async (req, res) => {
  try {
    const result = await checkPrerequisiteCompletion(req.user.userId, req.params.levelId);

    return res.json({
      success: true,
      levelId: req.params.levelId,
      prerequisiteCompleted: result.hasCompleted,
      prerequisiteId: result.prerequisiteId,
      details: result
    });
  } catch (error) {
    console.error('Check prerequisite error:', error);
    return res.status(500).json({
      error: 'CHECK_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/lessons/by-difficulty
 * Get lessons filtered by difficulty level
 * Query: difficulty=beginner|intermediate|advanced, topic=optional
 */
router.get('/lessons/by-difficulty', optionalAuth, async (req, res) => {
  try {
    const { difficulty, topic } = req.query;

    if (!difficulty || !['beginner', 'intermediate', 'advanced'].includes(difficulty)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'difficulty must be beginner, intermediate, or advanced'
      });
    }

    const lessons = await getLessonsByDifficulty(difficulty, topic || null);

    return res.json({
      success: true,
      difficulty,
      topic: topic || 'all',
      lessons: lessons,
      total: lessons.length
    });
  } catch (error) {
    console.error('Get lessons by difficulty error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/lessons/by-tags
 * Get lessons filtered by semantic tags
 * Query: tags=tag1,tag2,tag3&limit=10
 */
router.get('/lessons/by-tags', optionalAuth, async (req, res) => {
  try {
    const { tags, limit = 10 } = req.query;

    if (!tags) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'tags parameter required (comma-separated)'
      });
    }

    const tagArray = tags.split(',').map(t => t.trim());
    const lessons = await getLessonsByTags(tagArray, parseInt(limit));

    return res.json({
      success: true,
      tags: tagArray,
      lessons: lessons,
      total: lessons.length
    });
  } catch (error) {
    console.error('Get lessons by tags error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/student/recommended-next-lesson
 * Get recommended next lesson for authenticated student
 * Query: topic=law:criminal
 */
router.get('/student/recommended-next-lesson', verifyToken, async (req, res) => {
  try {
    const { topic } = req.query;

    if (!topic) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'topic parameter required'
      });
    }

    const nextLesson = await getRecommendedNextLesson(req.user.userId, topic);

    return res.json({
      success: true,
      topic,
      recommendedLesson: nextLesson,
      hasRecommendation: !!nextLesson
    });
  } catch (error) {
    console.error('Get recommended lesson error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * PUT /api/law/lessons/:levelId/metadata
 * Update lesson metadata (objectives, outcomes, difficulty, etc.)
 * Admin/teacher only
 */
router.put('/lessons/:levelId/metadata', verifyToken, async (req, res) => {
  try {
    // TODO: Add authorization check - only teachers/admins can update
    const updated = await updateLessonMetadata(req.params.levelId, req.body);

    return res.json({
      success: true,
      levelId: req.params.levelId,
      metadata: updated
    });
  } catch (error) {
    console.error('Update lesson metadata error:', error);
    return res.status(500).json({
      error: 'UPDATE_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/units/:unitId/lesson-stats
 * Get statistics about lessons in a unit
 */
router.get('/units/:unitId/lesson-stats', optionalAuth, async (req, res) => {
  try {
    const stats = await getUnitLessonStats(req.params.unitId);

    return res.json({
      success: true,
      unitId: req.params.unitId,
      stats: stats
    });
  } catch (error) {
    console.error('Get lesson stats error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/lessons/:levelId/view
 * Track that student viewed a lesson (for analytics)
 */
router.post('/lessons/:levelId/view', verifyToken, async (req, res) => {
  try {
    await trackLessonView(req.user.userId, req.params.levelId);

    return res.json({
      success: true,
      levelId: req.params.levelId,
      message: 'Lesson view tracked'
    });
  } catch (error) {
    console.error('Track lesson view error:', error);
    return res.status(500).json({
      error: 'TRACKING_ERROR',
      message: error.message
    });
  }
});

// ---------------------------------------------------------------------------
// Assessment Endpoints (Phase 2)
// ---------------------------------------------------------------------------

/**
 * GET /api/law/units/:unitId/assessments
 * Get all assessments for a unit (pre-test, formative, summative, post-test)
 */
router.get('/units/:unitId/assessments', optionalAuth, async (req, res) => {
  try {
    const assessments = await getUnitAssessments(req.params.unitId);

    return res.json({
      success: true,
      unitId: req.params.unitId,
      assessments,
      total: assessments.length
    });
  } catch (error) {
    console.error('Get unit assessments error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/assessments/:assessmentId
 * Get assessment with all questions
 */
router.get('/assessments/:assessmentId', optionalAuth, async (req, res) => {
  try {
    const assessment = await getAssessment(req.params.assessmentId);

    return res.json({
      success: true,
      assessment
    });
  } catch (error) {
    console.error('Get assessment error:', error);
    return res.status(error.message === 'Assessment not found' ? 404 : 500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/assessments/:assessmentId/submit
 * Submit assessment answers and get score
 */
router.post('/assessments/:assessmentId/submit', verifyToken, async (req, res) => {
  try {
    const { answers, timeSpentSeconds = 0 } = req.body;

    if (!answers) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'answers object required'
      });
    }

    // Check if can attempt
    const canAttempt = await canAttemptAssessment(req.params.assessmentId, req.user.userId);
    if (!canAttempt.canAttempt) {
      return res.status(403).json({
        error: 'ATTEMPT_LIMIT_EXCEEDED',
        message: canAttempt.reason
      });
    }

    const result = await submitAssessment(
      req.params.assessmentId,
      req.user.userId,
      answers,
      timeSpentSeconds
    );

    return res.status(201).json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Submit assessment error:', error);
    return res.status(500).json({
      error: 'SUBMISSION_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/assessments/:assessmentId/can-attempt
 * Check if student can attempt assessment again
 */
router.get('/assessments/:assessmentId/can-attempt', verifyToken, async (req, res) => {
  try {
    const result = await canAttemptAssessment(req.params.assessmentId, req.user.userId);

    return res.json({
      success: true,
      assessmentId: req.params.assessmentId,
      ...result
    });
  } catch (error) {
    console.error('Check attempt error:', error);
    return res.status(500).json({
      error: 'CHECK_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/student/assessment-history
 * Get authenticated student's assessment history
 * Query: ?assessment=assessmentId (optional)
 */
router.get('/student/assessment-history', verifyToken, async (req, res) => {
  try {
    const { assessment: assessmentId } = req.query;
    const history = await getStudentAssessmentHistory(req.user.userId, assessmentId || null);

    return res.json({
      success: true,
      userId: req.user.userId,
      attempts: history,
      total: history.length
    });
  } catch (error) {
    console.error('Get assessment history error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/student/competency-gaps
 * Get authenticated student's competency gaps
 * Query: ?topic=law:criminal (optional)
 */
router.get('/student/competency-gaps', verifyToken, async (req, res) => {
  try {
    const { topic } = req.query;
    const gaps = await getStudentCompetencyGaps(req.user.userId, topic || null);

    return res.json({
      success: true,
      userId: req.user.userId,
      topic: topic || 'all',
      gaps,
      total: gaps.length
    });
  } catch (error) {
    console.error('Get competency gaps error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/assessments/:assessmentId/analytics
 * Get assessment analytics (pass rate, average score, etc.)
 */
router.get('/assessments/:assessmentId/analytics', async (req, res) => {
  try {
    const analytics = await getAssessmentAnalytics(req.params.assessmentId);

    return res.json({
      success: true,
      assessmentId: req.params.assessmentId,
      analytics
    });
  } catch (error) {
    console.error('Get assessment analytics error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/questions/topic/:topicId
 * Get all questions for a topic (for quizzes, etc.)
 * Public endpoint - no auth required
 */
router.get('/questions/topic/:topicId', optionalAuth, async (req, res) => {
  try {
    const questions = await db.many(
      `SELECT id, prompt, type, correct_answer, explanation
       FROM question
       WHERE topic_id = $1
       ORDER BY id
       LIMIT 50`,
      [req.params.topicId]
    );

    return res.json({
      topicId: req.params.topicId,
      questions: questions || [],
      total: questions?.length || 0
    });
  } catch (error) {
    console.error('Get questions error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/assessment
 * Get law assessment for logged-in user
 * Requires authentication
 */
router.get('/assessment', verifyToken, async (req, res) => {
  try {
    const assessment = await getLawAssessment(req.user.userId);

    return res.json(assessment);
  } catch (error) {
    console.error('Get assessment error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/assessment/stats
 * Get comprehensive learning stats for user
 * Requires authentication
 */
router.get('/assessment/stats', verifyToken, async (req, res) => {
  try {
    const stats = await getLawLearningStats(req.user.userId);

    return res.json(stats);
  } catch (error) {
    console.error('Get assessment stats error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/assessment/mastery
 * Get topic mastery breakdown for user
 * Requires authentication
 */
router.get('/assessment/mastery', verifyToken, async (req, res) => {
  try {
    const mastery = await getTopicMastery(req.user.userId);

    return res.json(mastery);
  } catch (error) {
    console.error('Get mastery error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/assessment/recommended
 * Get recommended next units for user
 * Requires authentication
 */
router.get('/assessment/recommended', verifyToken, async (req, res) => {
  try {
    const recommended = await getRecommendedNextUnits(req.user.userId, 5);

    return res.json({ recommended });
  } catch (error) {
    console.error('Get recommended error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

// ---------------------------------------------------------------------------
// Vector Embeddings & Semantic Search
// ---------------------------------------------------------------------------

/**
 * POST /api/law/embeddings/generate-statutes
 * Generate embeddings for all employment law statutes
 * Requires authentication
 */
router.post('/embeddings/generate-statutes', verifyToken, async (req, res) => {
  try {
    const { forceRefresh = false } = req.body;

    console.log('Starting statute embedding generation...');
    const result = await embedEmploymentStatutes(req.brandId, { forceRefresh });

    return res.status(200).json({
      success: true,
      embedded: result.embedded,
      skipped: result.skipped,
      totalCost: parseFloat(result.totalCost.toFixed(4)),
      message: `Embedding complete: ${result.embedded} statutes embedded, ${result.skipped} skipped`
    });
  } catch (error) {
    console.error('Statute embedding error:', error);
    return res.status(500).json({
      error: 'EMBEDDING_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/embeddings/generate-cases
 * Generate embeddings for all employment law cases
 * Requires authentication
 */
router.post('/embeddings/generate-cases', verifyToken, async (req, res) => {
  try {
    const { forceRefresh = false } = req.body;

    console.log('Starting case embedding generation...');
    const result = await embedEmploymentCases(req.brandId, { forceRefresh });

    return res.status(200).json({
      success: true,
      embedded: result.embedded,
      skipped: result.skipped,
      totalCost: parseFloat(result.totalCost.toFixed(4)),
      message: `Embedding complete: ${result.embedded} cases embedded, ${result.skipped} skipped`
    });
  } catch (error) {
    console.error('Case embedding error:', error);
    return res.status(500).json({
      error: 'EMBEDDING_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/search-semantic
 * Semantic search across law documents using vector similarity
 * Body: { query: string, limit?: number, minSimilarity?: number, type?: 'statute'|'case'|'all' }
 */
router.post('/search-semantic', optionalAuth, async (req, res) => {
  try {
    const {
      query,
      limit = 10,
      minSimilarity = 0.5,
      type = 'all'
    } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'query is required'
      });
    }

    let results = [];

    if (type === 'statute') {
      results = await semanticSearchStatutes(req.brandId, query, { limit, minSimilarity });
      results = results.map(r => ({
        ...r,
        type: 'statute'
      }));
    } else if (type === 'case') {
      results = await semanticSearchCases(req.brandId, query, { limit, minSimilarity });
      results = results.map(r => ({
        ...r,
        type: 'case'
      }));
    } else {
      results = await semanticSearchAll(req.brandId, query, { limit, minSimilarity });
    }

    // Log search
    await db.query(
      `INSERT INTO law_search_history (brand_id, user_id, query, filters, result_count, search_type)
       VALUES ($1, $2, $3, $4, $5, 'semantic_search')`,
      [
        req.brandId,
        req.user?.userId || null,
        query,
        JSON.stringify({ type, minSimilarity }),
        results.length
      ]
    );

    return res.json({
      query,
      searchType: 'semantic',
      documentType: type,
      results: results.map(r => ({
        id: r.id,
        type: r.type || type,
        title: r.name || r.title,
        citation: r.citation,
        similarity: Math.round(r.similarity_score * 1000) / 1000,
        jurisdiction: r.jurisdiction,
        year: r.year,
        ...(r.short_title && { shortTitle: r.short_title }),
        ...(r.status && { status: r.status }),
        ...(r.court && { court: r.court })
      })),
      total: results.length
    });
  } catch (error) {
    console.error('Semantic search error:', error);
    return res.status(500).json({
      error: 'SEARCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/embeddings/stats
 * Get embedding generation statistics
 * Public endpoint
 */
router.get('/embeddings/stats', optionalAuth, async (req, res) => {
  try {
    const stats = await getEmbeddingStats(req.brandId);

    return res.json({
      embeddingStats: stats,
      model: 'text-embedding-3-small',
      dimension: 1536,
      ready: stats.progress.percentComplete === 100
    });
  } catch (error) {
    console.error('Stats retrieval error:', error);
    return res.status(500).json({
      error: 'STATS_ERROR',
      message: error.message
    });
  }
});

// ---------------------------------------------------------------------------
// Secure Legal Consultations (AI + Encryption)
// ---------------------------------------------------------------------------

/**
 * POST /api/law/consultations
 * Create a new encrypted legal consultation
 * Case intake form endpoint
 */
router.post('/consultations', verifyToken, auditLog('consultation_created', 'consultation'), async (req, res) => {
  try {
    const {
      caseTitle,
      jurisdiction,
      caseType,
      facts,
      legalQuestions,
      confidentialityLevel = 'high'
    } = req.body;

    // Validation
    if (!caseTitle || !jurisdiction || !caseType || !facts || !legalQuestions) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'caseTitle, jurisdiction, caseType, facts, legalQuestions are required'
      });
    }

    const validJurisdictions = ['cth', 'nsw', 'vic', 'qld', 'sa', 'wa', 'tas', 'nt', 'act'];
    if (!validJurisdictions.includes(jurisdiction)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `Invalid jurisdiction: ${jurisdiction}`
      });
    }

    if (!isEncryptionConfigured()) {
      return res.status(500).json({
        error: 'ENCRYPTION_ERROR',
        message: 'Encryption service not configured'
      });
    }

    // Encrypt sensitive fields
    const caseTitleEncrypted = await encryptField(caseTitle);
    const factsEncrypted = await encryptField(facts);
    const legalQuestionsEncrypted = await encryptField(legalQuestions);

    // Create consultation
    const consultation = await db.one(
      `INSERT INTO law_consultations (
        id, brand_id, user_id, jurisdiction, case_type,
        case_title_encrypted, facts_encrypted, legal_questions_encrypted,
        is_privileged, confidentiality_level, encryption_key_version,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, 1, 'active', NOW(), NOW())
      RETURNING id, brand_id, user_id, jurisdiction, case_type, is_privileged,
                confidentiality_level, status, created_at`,
      [
        uuidv4(),
        req.brandId,
        req.user.userId,
        jurisdiction,
        caseType,
        caseTitleEncrypted,
        factsEncrypted,
        legalQuestionsEncrypted,
        confidentialityLevel
      ]
    );

    // Create retention policy (default 7 years)
    await db.query(
      `INSERT INTO law_consultation_retention (
        id, consultation_id, brand_id, retention_years, retention_reason, created_at, updated_at
      ) VALUES ($1, $2, $3, 7, 'statute_of_limitations', NOW(), NOW())`,
      [uuidv4(), consultation.id, req.brandId]
    );

    // Create initial stats record
    await db.query(
      `INSERT INTO law_consultation_stats (
        id, consultation_id, brand_id, created_at, updated_at
      ) VALUES ($1, $2, $3, NOW(), NOW())`,
      [uuidv4(), consultation.id, req.brandId]
    );

    return res.status(201).json({
      id: consultation.id,
      jurisdiction: consultation.jurisdiction,
      caseType: consultation.case_type,
      status: consultation.status,
      confidentialityLevel: consultation.confidentiality_level,
      createdAt: consultation.created_at,
      message: 'Consultation created successfully'
    });
  } catch (error) {
    console.error('Create consultation error:', error);
    return res.status(500).json({
      error: 'CREATION_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/consultations
 * List user's consultations (authenticated)
 */
router.get('/consultations', verifyToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    // Get consultations user owns or has access to
    const consultations = await getUserConsultations(
      req.user.userId,
      req.brandId,
      { limit: parseInt(limit), offset: parseInt(offset) }
    );

    return res.json({
      consultations: consultations.map(c => ({
        id: c.id,
        jurisdiction: c.jurisdiction,
        caseType: c.case_type,
        status: c.status,
        isOwner: c.is_owner,
        accessLevel: c.access_level || (c.is_owner ? 'admin' : null),
        confidentialityLevel: c.confidentiality_level,
        createdAt: c.created_at
      })),
      total: consultations.length
    });
  } catch (error) {
    console.error('List consultations error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/consultations/:id
 * Retrieve encrypted consultation (decrypted for authorized user)
 */
router.get('/consultations/:id', verifyToken, requireConsultationAccess('read'), auditLog('consultation_viewed', 'consultation'), async (req, res) => {
  try {
    const consultation = await db.one(
      `SELECT * FROM law_consultations WHERE id = $1 AND brand_id = $2`,
      [req.params.id, req.brandId]
    );

    if (!consultation) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    // Decrypt sensitive fields
    const decrypted = await decryptRow(consultation, [
      'case_title_encrypted',
      'facts_encrypted',
      'legal_questions_encrypted'
    ]);

    return res.json({
      id: consultation.id,
      caseTitle: decrypted.case_title_encrypted,
      jurisdiction: consultation.jurisdiction,
      caseType: consultation.case_type,
      facts: decrypted.facts_encrypted,
      legalQuestions: decrypted.legal_questions_encrypted,
      status: consultation.status,
      confidentialityLevel: consultation.confidentiality_level,
      isPrivileged: consultation.is_privileged,
      legalHold: consultation.legal_hold,
      createdAt: consultation.created_at,
      updatedAt: consultation.updated_at
    });
  } catch (error) {
    console.error('Get consultation error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/law/consultations/:consultationId/chat
 * Send message and get AI response with citations
 */
router.post('/consultations/:consultationId/chat', verifyToken, requireConsultationAccess('write'), async (req, res) => {
  try {
    const { message } = req.body;
    const consultationId = req.params.consultationId;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'message (string) required'
      });
    }

    // Get consultation
    const consultation = await db.one(
      `SELECT * FROM law_consultations WHERE id = $1 AND brand_id = $2`,
      [consultationId, req.brandId]
    );

    if (!consultation) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    // Decrypt consultation context
    const consultationDecrypted = await decryptRow(consultation, [
      'case_title_encrypted',
      'facts_encrypted',
      'legal_questions_encrypted'
    ]);

    // Get conversation history (limit to last 10 messages for context)
    const messageHistory = await db.many(
      `SELECT id, sender_type, message_content_encrypted, ai_model
       FROM law_consultation_messages
       WHERE consultation_id = $1
       ORDER BY message_sequence DESC
       LIMIT 10`,
      [consultationId]
    );

    // Decrypt history
    const decryptedHistory = await Promise.all(
      messageHistory
        .reverse()
        .map(async msg => ({
          ...msg,
          message_content: await decryptField(msg.message_content_encrypted)
        }))
    );

    // Save user message first
    const messageSequence = messageHistory.length + 1;
    const userMessageEncrypted = await encryptField(message);

    const userMsg = await db.one(
      `INSERT INTO law_consultation_messages (
        id, consultation_id, brand_id, sender_type, message_sequence,
        message_content_encrypted, encryption_key_version, created_at
      ) VALUES ($1, $2, $3, 'user', $4, $5, 1, NOW())
      RETURNING id, message_sequence`,
      [uuidv4(), consultationId, req.brandId, messageSequence, userMessageEncrypted]
    );

    // Generate AI response
    const aiResponse = await generateLegalResponse(
      consultationDecrypted,
      decryptedHistory,
      message
    );

    // Save AI response
    const aiMessageId = uuidv4();
    const aiMessageEncrypted = await encryptField(aiResponse.responseText);

    const aiMsg = await db.one(
      `INSERT INTO law_consultation_messages (
        id, consultation_id, brand_id, sender_type, message_sequence,
        message_content_encrypted, ai_model, ai_prompt_tokens,
        ai_completion_tokens, ai_cost_usd, encryption_key_version, created_at
      ) VALUES ($1, $2, $3, 'ai', $4, $5, $6, $7, $8, $9, 1, NOW())
      RETURNING id, message_sequence`,
      [
        aiMessageId,
        consultationId,
        req.brandId,
        messageSequence + 1,
        aiMessageEncrypted,
        aiResponse.model,
        aiResponse.promptTokens,
        aiResponse.completionTokens,
        aiResponse.costUsd
      ]
    );

    // Save citations
    for (const citation of aiResponse.citations) {
      await db.query(
        `INSERT INTO law_ai_citations (
          id, message_id, brand_id, citation_type,
          source_statute_id, source_case_id,
          citation_text, quoted_text, relevance_score,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          uuidv4(),
          aiMessageId,
          req.brandId,
          citation.type,
          citation.sourceStatuteId || null,
          citation.sourceCaseId || null,
          citation.citationText,
          citation.quotedText || null,
          citation.relevance_score || 1.0
        ]
      );
    }

    // Update consultation stats
    await db.query(
      `UPDATE law_consultation_stats
       SET total_user_messages = total_user_messages + 1,
           total_ai_messages = total_ai_messages + 1,
           total_prompt_tokens = total_prompt_tokens + $1,
           total_completion_tokens = total_completion_tokens + $2,
           total_cost_usd = total_cost_usd + $3,
           last_message_at = NOW(),
           total_citations = total_citations + $4,
           updated_at = NOW()
       WHERE consultation_id = $5`,
      [
        aiResponse.promptTokens,
        aiResponse.completionTokens,
        aiResponse.costUsd,
        aiResponse.citations.length,
        consultationId
      ]
    );

    // Log the chat interaction
    await db.query(
      `INSERT INTO law_audit_log (
        id, brand_id, user_id, action_type, resource_type, resource_id,
        action_metadata, action_result, created_at
      ) VALUES ($1, $2, $3, 'message_sent', 'message', $4,
                $5, 'success', NOW())`,
      [
        uuidv4(),
        req.brandId,
        req.user.userId,
        aiMessageId,
        JSON.stringify({
          messageSequence: messageSequence + 1,
          citationCount: aiResponse.citations.length,
          tokensCost: aiResponse.costUsd
        })
      ]
    );

    return res.status(201).json({
      userMessage: {
        id: userMsg.id,
        sequence: userMsg.message_sequence,
        content: message,
        senderType: 'user',
        createdAt: new Date().toISOString()
      },
      aiResponse: {
        id: aiMsg.id,
        sequence: aiMsg.message_sequence,
        content: aiResponse.responseText,
        senderType: 'ai',
        model: aiResponse.model,
        citations: aiResponse.citations.map(c => ({
          type: c.type,
          text: c.citationText,
          sourceId: c.sourceStatuteId || c.sourceCaseId,
          sourceTitle: c.sourceTitle,
          warning: c.warning
        })),
        tokens: {
          prompt: aiResponse.promptTokens,
          completion: aiResponse.completionTokens
        },
        costUsd: aiResponse.costUsd,
        createdAt: new Date().toISOString()
      },
      disclaimer: 'This is not legal advice. Please consult a qualified lawyer for your specific situation.'
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({
      error: 'CHAT_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/consultations/:consultationId/messages
 * Get conversation history for a consultation
 */
router.get('/consultations/:consultationId/messages', verifyToken, requireConsultationAccess('read'), async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const consultationId = req.params.consultationId;

    const messages = await db.many(
      `SELECT id, sender_type, message_sequence, ai_model, ai_prompt_tokens,
              ai_completion_tokens, ai_cost_usd, created_at
       FROM law_consultation_messages
       WHERE consultation_id = $1
       ORDER BY message_sequence ASC
       LIMIT $2 OFFSET $3`,
      [consultationId, parseInt(limit), parseInt(offset)]
    );

    // Decrypt message contents
    const decrypted = await Promise.all(
      messages.map(async msg => {
        const content = await decryptField(msg.message_content_encrypted);
        return {
          id: msg.id,
          senderType: msg.sender_type,
          sequence: msg.message_sequence,
          content,
          aiModel: msg.ai_model,
          tokens: msg.ai_prompt_tokens ? {
            prompt: msg.ai_prompt_tokens,
            completion: msg.ai_completion_tokens
          } : null,
          costUsd: msg.ai_cost_usd,
          createdAt: msg.created_at
        };
      })
    );

    return res.json({
      consultationId,
      messages: decrypted,
      total: decrypted.length
    });
  } catch (error) {
    console.error('Get messages error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/law/consultations/:consultationId/stats
 * Get consultation statistics (usage, costs, etc.)
 */
router.get('/consultations/:consultationId/stats', verifyToken, requireConsultationAccess('read'), async (req, res) => {
  try {
    const stats = await db.one(
      `SELECT * FROM law_consultation_stats WHERE consultation_id = $1`,
      [req.params.consultationId]
    );

    if (!stats) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json({
      consultationId: stats.consultation_id,
      messages: {
        user: stats.total_user_messages,
        ai: stats.total_ai_messages,
        total: stats.total_user_messages + stats.total_ai_messages
      },
      tokens: {
        prompt: stats.total_prompt_tokens,
        completion: stats.total_completion_tokens,
        total: stats.total_prompt_tokens + stats.total_completion_tokens
      },
      citations: {
        total: stats.total_citations,
        statutes: stats.statute_citations,
        cases: stats.case_citations
      },
      cost: {
        totalUsd: stats.total_cost_usd,
        averagePerMessage: stats.total_user_messages > 0
          ? (stats.total_cost_usd / stats.total_user_messages).toFixed(4)
          : 0
      },
      timing: {
        firstMessage: stats.first_message_at,
        lastMessage: stats.last_message_at,
        averageResponseTimeSeconds: stats.average_response_time_seconds
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({
      error: 'FETCH_ERROR',
      message: error.message
    });
  }
});

export default router;
