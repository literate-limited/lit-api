import { Router } from 'express';
import db from '../db.js';
import {
  processStudentMessage,
  getConversationWithSegments,
  checkUnitAssignmentTrigger
} from '../services/message.service.js';

const router = Router();

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

/**
 * POST /messages/:roomId
 * Process a student message with full pipeline:
 * - Store raw message
 * - Analyze with Claude (language tagging, error detection)
 * - Store segments (word-level with language codes)
 * - Update student assessment
 * - Generate AI response
 * - Check unit assignment trigger
 *
 * Body:
 * {
 *   "studentId": "uuid",
 *   "content": "Je want aller au cinema",
 *   "targetLanguage": "fr"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": {
 *     "id": "uuid",
 *     "raw_text": "Je want aller au cinema",
 *     "segments": [
 *       {"text": "Je", "language": "fr", "is_error": false},
 *       {"text": "want", "language": "en", "is_error": true, "correction": "veux"}
 *     ]
 *   },
 *   "analysis": {
 *     "error_count": 1,
 *     "error_rate": 20.0,
 *     "identified_gaps": ["present_tense_vouloir"],
 *     "language_distribution": {"target_language_pct": 0.83, "l1_pct": 0.17}
 *   },
 *   "aiResponse": {
 *     "id": "uuid",
 *     "text": "Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?"
 *   },
 *   "unitTrigger": {
 *     "triggered": false,
 *     "reason": "Only 1 error, not enough to trigger unit"
 *   }
 * }
 */
router.post('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { studentId, content, targetLanguage } = req.body;

    // Validate required fields
    if (!studentId || !content || !targetLanguage) {
      return res.status(400).json({
        error: 'Missing required fields: studentId, content, targetLanguage'
      });
    }

    // Validate room exists
    const room = await db.one('SELECT id FROM chat_rooms WHERE id = $1', [roomId]);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Validate student exists
    const student = await db.one(
      "SELECT id FROM users WHERE id = $1 AND role = 'student'",
      [studentId]
    );
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Process student message through full pipeline
    const result = await processStudentMessage(roomId, studentId, content, targetLanguage);

    // Fetch the stored message + segments for flip-able rendering
    const messageRow = await db.one(
      `
        SELECT id, raw_text, created_at
        FROM message
        WHERE id = $1
      `,
      [result.messageId]
    );

    const segments = await db.many(
      `
        SELECT
          segment_text as text,
          language_code as language,
          is_error,
          error_type,
          correction,
          error_explanation,
          char_start,
          char_end
        FROM message_segment
        WHERE message_id = $1
        ORDER BY segment_index ASC
      `,
      [result.messageId]
    );

    // Get unit assignment trigger info
    const unitTrigger = await checkUnitAssignmentTrigger(studentId, targetLanguage);

    res.json({
      success: true,
      message: {
        id: result.messageId,
        raw_text: messageRow?.raw_text ?? content,
        created_at: messageRow?.created_at ?? new Date().toISOString(),
        segments: segments || []
      },
      analysis: {
        error_count: result.analysis.error_count,
        error_rate: result.analysis.error_rate,
        identified_gaps: result.analysis.identified_gaps,
        demonstrated_topics: result.analysis.demonstrated_topics,
        language_distribution: result.analysis.language_distribution,
        vocabulary_analysis: result.analysis.vocabulary_analysis
      },
      aiResponse: result.aiResponse,
      assessment: {
        should_trigger_unit: result.shouldTriggerUnit,
        next_unit: unitTrigger ? { id: unitTrigger.id, name: unitTrigger.name } : null
      }
    });

  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({
      error: 'Failed to process message',
      message: error.message
    });
  }
});

/**
 * GET /messages/:roomId
 * Get conversation history with segments for flip-able rendering
 *
 * Query params:
 * - limit (default: 50) - Number of messages to return
 *
 * Response:
 * [
 *   {
 *     "id": "uuid",
 *     "sender_role": "student",
 *     "raw_text": "Je want aller au cinema",
 *     "created_at": "2024-01-15T10:30:00Z",
 *     "segments": [
 *       {"text": "Je", "language": "fr", "is_error": false},
 *       {"text": "want", "language": "en", "is_error": true, "correction": "veux"}
 *     ]
 *   },
 *   {
 *     "id": "uuid",
 *     "sender_role": "ai",
 *     "raw_text": "Oh, tu veux aller au cinéma? Bonne idée!",
 *     "created_at": "2024-01-15T10:30:05Z",
 *     "segments": []
 *   }
 * ]
 */
router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    // Validate room exists
    const room = await db.one('SELECT id FROM chat_rooms WHERE id = $1', [roomId]);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Get conversation with segments
    const messages = await getConversationWithSegments(roomId, limit);
    res.json(messages);

  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      error: 'Failed to fetch messages',
      message: error.message
    });
  }
});

/**
 * GET /messages/:roomId/:messageId
 * Get a specific message with full analysis
 *
 * Response:
 * {
 *   "id": "uuid",
 *   "sender_role": "student",
 *   "raw_text": "Je want aller au cinema",
 *   "segments": [...],
 *   "analysis": {
 *     "error_count": 1,
 *     "error_rate": 20.0,
 *     "identified_gaps": ["present_tense_vouloir"],
 *     "language_distribution": {...}
 *   },
 *   "ai_response": {
 *     "id": "uuid",
 *     "text": "Oh, tu veux aller au cinéma?...",
 *     "pedagogical_intent": "correct_implicitly"
 *   }
 * }
 */
router.get('/:roomId/:messageId', async (req, res) => {
  try {
    const { roomId, messageId } = req.params;

    // Get message with segments
    const message = await db.one(
      `
        SELECT *
        FROM message
        WHERE id = $1 AND room_id = $2
      `,
      [messageId, roomId]
    );

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Get segments
    const segments = await db.many(
      `
        SELECT
          segment_text as text,
          language_code as language,
          is_error,
          error_type,
          correction,
          error_explanation,
          char_start,
          char_end
        FROM message_segment
        WHERE message_id = $1
        ORDER BY segment_index ASC
      `,
      [messageId]
    );

    // Get analysis if it's a student message
    let analysis = null;
    if (message.sender_role === 'student') {
      const analysisRow = await db.one(
        `
          SELECT
            error_count,
            error_rate,
            error_types,
            vocabulary_analysis,
            grammar_structures,
            confidence_indicators,
            demonstrated_topics,
            identified_gaps,
            should_trigger_unit,
            language_distribution
          FROM message_analysis
          WHERE message_id = $1
        `,
        [messageId]
      );

      analysis = analysisRow
        ? {
            error_count: analysisRow.error_count,
            error_rate: analysisRow.error_rate,
            error_types: safeJson(analysisRow.error_types, {}),
            vocabulary_analysis: safeJson(analysisRow.vocabulary_analysis, {}),
            grammar_structures: safeJson(analysisRow.grammar_structures, []),
            confidence_indicators: safeJson(analysisRow.confidence_indicators, {}),
            demonstrated_topics: safeJson(analysisRow.demonstrated_topics, []),
            identified_gaps: safeJson(analysisRow.identified_gaps, []),
            should_trigger_unit: analysisRow.should_trigger_unit,
            language_distribution: safeJson(analysisRow.language_distribution, {}),
          }
        : null;
    }

    // Get AI response if this is an AI message
    let aiResponse = null;
    if (message.sender_role === 'ai') {
      const aiData = await db.one(
        `
          SELECT
            pedagogical_intent,
            corrects_error_implicitly,
            incorporates_topics,
            introduces_vocabulary
          FROM ai_response
          WHERE ai_message_id = $1
        `,
        [messageId]
      );

      aiResponse = aiData
        ? {
            id: messageId,
            text: message.raw_text,
            pedagogical_intent: aiData.pedagogical_intent,
            corrects_error_implicitly: aiData.corrects_error_implicitly,
            incorporates_topics: safeJson(aiData.incorporates_topics, []),
            introduces_vocabulary: safeJson(aiData.introduces_vocabulary, []),
          }
        : null;
    }

    res.json({
      id: message.id,
      sender_role: message.sender_role,
      raw_text: message.raw_text,
      target_language: message.target_language,
      created_at: message.created_at,
      segments: segments || [],
      analysis,
      ai_response: aiResponse
    });

  } catch (error) {
    console.error('Error fetching message details:', error);
    res.status(500).json({
      error: 'Failed to fetch message',
      message: error.message
    });
  }
});

export default router;
