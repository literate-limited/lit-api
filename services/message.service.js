import db from '../db.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const toJson = (value) => JSON.stringify(value ?? null);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 8000, // 8 second timeout to fail fast if rate limited
  maxRetries: 0  // Don't retry on failure
});

/**
 * Process a student message:
 * 1. Store raw message
 * 2. Analyze language use (L1/L2 segmentation)
 * 3. Detect errors
 * 4. Generate assessment
 * 5. Trigger AI response
 * 6. Check for unit assignment trigger
 */
export async function processStudentMessage(roomId, studentId, rawText, targetLanguage) {
  try {
    console.log(`Processing message from ${studentId}: "${rawText}"`);

    // 1. Store the raw message
    const { v4: uuidv4 } = await import('uuid');
    const messageId = uuidv4();

    await db.query(
      `
        INSERT INTO message (id, room_id, sender_id, sender_role, message_type, raw_text, target_language)
        VALUES ($1, $2, $3, 'student', 'text', $4, $5)
      `,
      [messageId, roomId, studentId, rawText, targetLanguage]
    );

    // 2. Analyze with Claude API
    const analysis = await analyzeMessageWithClaude(rawText, targetLanguage);

    const shouldTriggerUnit =
      Array.isArray(analysis.identified_gaps) &&
      analysis.identified_gaps.length > 0 &&
      Boolean(analysis.should_trigger);

    // 3-6. Store derived artifacts in a short transaction (no OpenAI calls inside).
    await db.tx(async (tx) => {
      await storeMessageSegments(tx, messageId, rawText, analysis.segments || []);
      await storeMessageAnalysis(tx, messageId, analysis, shouldTriggerUnit);
      await updateStudentAssessmentFromMessage(tx, studentId, targetLanguage, analysis);
    });

    // 7. Generate and store AI response
    const aiResponse = await generateAIResponse(roomId, messageId, rawText, analysis, targetLanguage);

    return {
      messageId: messageId,
      analysis,
      shouldTriggerUnit,
      aiResponse
    };

  } catch (error) {
    console.error('Error processing student message:', error);
    throw error;
  }
}

/**
 * Analyze message with Claude API
 * Detects:
 * - Language of each word/phrase (target lang vs L1)
 * - Errors (grammar, vocabulary, spelling, syntax)
 * - Vocabulary metrics
 * - Grammar structures used
 */
async function analyzeMessageWithClaude(rawText, targetLanguage) {
  const languageName = targetLanguage === 'fr' ? 'French' : 'Spanish';

  const prompt = `You are a language learning assessment expert. Analyze this ${languageName} message and provide detailed linguistic feedback.

Message: "${rawText}"
Target Language: ${languageName}

Provide your response as a JSON object with this exact structure:
{
  "segments": [
    {
      "text": "word or phrase",
      "language_code": "fr|en|es|other|mixed",
      "is_error": false,
      "error_type": null,
      "correction": null,
      "error_explanation": null,
      "is_new_vocabulary": false
    }
  ],
  "language_distribution": {
    "target_language_pct": 0.85,
    "l1_pct": 0.15,
    "mixed_pct": 0,
    "unknown_pct": 0
  },
  "error_count": 1,
  "error_rate": 10.0,
  "error_types": {
    "vocabulary": 1,
    "grammar": 0,
    "spelling": 0
  },
  "vocabulary_analysis": {
    "unique_words": 8,
    "known_words": 6,
    "new_words": 2,
    "complexity_score": 0.65
  },
  "grammar_structures": ["present_tense", "question_formation"],
  "confidence_indicators": {
    "fluency_score": 0.7,
    "complexity_level": "beginner|intermediate|advanced",
    "self_correction_attempts": 0
  },
  "demonstrated_topics": ["greetings", "present_tense"],
  "identified_gaps": ["past_tense", "formal_address"],
  "should_trigger": false
}

For "language_code": use target language code (fr/es), 'en' for English, or 'mixed' if code-switched.
For errors: be lenient on minor typos but strict on grammar/conjugation/vocabulary.
For "should_trigger": true only if 2+ significant errors OR major gap identified.
For "new_words": mark as true if you believe the student just learned this word recently.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Cost-efficient model for production
      temperature: 0.7,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const content = response.choices[0].message.content;

    // Extract JSON from response (in case OpenAI wraps it in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const analysis = JSON.parse(jsonStr);

    return analysis;

  } catch (error) {
    console.error('OpenAI API error:', error);
    // Return minimal analysis if OpenAI fails
    return {
      segments: [{ text: rawText, language_code: targetLanguage, is_error: false }],
      language_distribution: { target_language_pct: 1.0, l1_pct: 0, mixed_pct: 0, unknown_pct: 0 },
      error_count: 0,
      error_rate: 0,
      error_types: {},
      vocabulary_analysis: {},
      grammar_structures: [],
      confidence_indicators: { fluency_score: 0.5, complexity_level: 'beginner', self_correction_attempts: 0 },
      demonstrated_topics: [],
      identified_gaps: [],
      should_trigger: false
    };
  }
}

/**
 * Store message segments (word/phrase level with language tags)
 */
async function storeMessageSegments(conn, messageId, rawText, segments) {
  const { v4: uuidv4 } = await import('uuid');

  let charPos = 0;
  for (const [index, seg] of segments.entries()) {
    // Find segment in raw text (simple approach - may need refinement)
    const charStart = rawText.indexOf(seg.text, charPos);
    const charEnd = charStart + seg.text.length;

    await conn.query(
      `
        INSERT INTO message_segment
        (id, message_id, segment_index, segment_text, language_code, char_start, char_end,
         is_error, error_type, correction, error_explanation, is_new_vocabulary)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        uuidv4(),
        messageId,
        index,
        seg.text,
        seg.language_code,
        charStart >= 0 ? charStart : charPos,
        charStart >= 0 ? charEnd : charPos + seg.text.length,
        Boolean(seg.is_error),
        seg.error_type || null,
        seg.correction || null,
        seg.error_explanation || null,
        Boolean(seg.is_new_vocabulary),
      ]
    );

    charPos = Math.max(charPos, charEnd);
  }
}

/**
 * Store message analysis (high-level metrics)
 */
async function storeMessageAnalysis(conn, messageId, analysis, shouldTriggerUnit) {
  const { v4: uuidv4 } = await import('uuid');
  const analysisId = uuidv4();

  await conn.query(
    `
      INSERT INTO message_analysis
      (id, message_id, language_distribution, error_count, error_rate, error_types,
       vocabulary_analysis, grammar_structures, confidence_indicators,
       demonstrated_topics, identified_gaps, should_trigger_unit)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `,
    [
      analysisId,
      messageId,
      toJson(analysis.language_distribution || {}),
      analysis.error_count || 0,
      analysis.error_rate || 0,
      toJson(analysis.error_types || {}),
      toJson(analysis.vocabulary_analysis || {}),
      toJson(analysis.grammar_structures || []),
      toJson(analysis.confidence_indicators || {}),
      toJson(analysis.demonstrated_topics || []),
      toJson(analysis.identified_gaps || []),
      Boolean(shouldTriggerUnit),
    ]
  );
}

/**
 * Update student assessment based on this message
 */
async function updateStudentAssessmentFromMessage(conn, studentId, language, analysis) {
  const { v4: uuidv4 } = await import("uuid");

  const existing = await conn.one(
    `
      SELECT target_language_pct, error_rate, competency_gaps
      FROM student_assessment
      WHERE user_id = $1 AND language = $2
    `,
    [studentId, language]
  );

  const prevTarget = existing?.target_language_pct ?? 0;
  const prevError = existing?.error_rate ?? 1;
  const prevGaps = Array.isArray(existing?.competency_gaps) ? existing.competency_gaps : [];

  const langDist = analysis.language_distribution || {};
  const nextTargetPct = (prevTarget * 0.7) + ((langDist.target_language_pct || 0) * 0.3);
  const nextErrorRate = (prevError * 0.7) + ((analysis.error_rate || 0) * 0.3);
  const nextFluency = analysis.confidence_indicators?.fluency_score || 0.5;

  const identified = Array.isArray(analysis.identified_gaps) ? analysis.identified_gaps : [];
  const mergedGaps = Array.from(new Set([...prevGaps, ...identified]));

  const confidenceLevel =
    nextTargetPct > 0.8 ? "high" : nextTargetPct > 0.5 ? "medium" : "low";

  await conn.query(
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
    `,
    [
      uuidv4(),
      studentId,
      language,
      null,
      nextTargetPct,
      nextFluency,
      nextErrorRate,
      confidenceLevel,
      mergedGaps,
    ]
  );
}

/**
 * Generate AI response to student message
 */
async function generateAIResponse(roomId, respondingToMessageId, studentMessage, analysis, targetLanguage) {
  const languageName = targetLanguage === 'fr' ? 'French' : 'Spanish';

  const prompt = `You are a friendly language teacher having a conversation with a student learning ${languageName}.

Student just said: "${studentMessage}"

Analysis of their message:
- Language purity: ${(analysis.language_distribution.target_language_pct * 100).toFixed(0)}% ${languageName}
- Errors found: ${analysis.error_count} (${analysis.error_rate.toFixed(1)} errors per 100 words)
- Topics demonstrated: ${analysis.demonstrated_topics.join(', ') || 'basic'}
- Gaps identified: ${analysis.identified_gaps.join(', ') || 'none'}

Guidelines for your response:
1. Respond primarily in ${languageName} (80%+)
2. Use simple, conversational language
3. If they made errors, correct them implicitly by using the correct form naturally
4. Ask a follow-up question to keep conversation going
5. Incorporate some new vocabulary if possible
6. Be encouraging and positive
7. Keep response to 1-2 sentences

Generate ONLY the response text (no JSON, no meta-commentary).`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Cost-efficient model for production
      temperature: 0.7,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const aiText = response.choices[0].message.content.trim();

    // Store AI message
    const { v4: uuidv4 } = await import('uuid');
    const aiMessageId = uuidv4();

    // Ensure AI user exists (system identity)
    let aiUser = await db.one("SELECT id FROM users WHERE email = $1", ["ai@litlang.com"]);
    if (!aiUser) {
      const aiUserId = uuidv4();
      await db.query(
        `
          INSERT INTO users (id, first_name, last_name, email, role)
          VALUES ($1, 'AI', 'Assistant', 'ai@litlang.com', 'teacher')
        `,
        [aiUserId]
      );
      aiUser = { id: aiUserId };
    }

    await db.query(
      `
        INSERT INTO message (id, room_id, sender_id, sender_role, message_type, raw_text, target_language)
        VALUES ($1, $2, $3, 'ai', 'text', $4, $5)
      `,
      [aiMessageId, roomId, aiUser.id, aiText, targetLanguage]
    );

    // Store AI response metadata
    const pedagogicalIntent = analysis.error_count > 0 ? 'correct_implicitly' : 'extend_vocabulary';
    const aiResponseId = uuidv4();

    await db.query(
      `
        INSERT INTO ai_response
        (id, ai_message_id, responding_to_message_id, pedagogical_intent, incorporates_topics, corrects_error_implicitly)
        VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [
        aiResponseId,
        aiMessageId,
        respondingToMessageId,
        pedagogicalIntent,
        toJson(analysis.demonstrated_topics || []),
        analysis.error_count > 0,
      ]
    );

    return {
      messageId: aiMessageId,
      text: aiText
    };

  } catch (error) {
    console.error('Error generating AI response:', error);
    return {
      messageId: null,
      text: targetLanguage === 'fr' ? 'C\'est intéressant!' : '¡Qué interesante!'
    };
  }
}

/**
 * Get conversation with all segments (for flip-able rendering)
 */
export async function getConversationWithSegments(roomId, limit = 50) {
  const rows = await db.many(
    `
      SELECT
        m.id,
        m.sender_role,
        m.raw_text,
        m.created_at
      FROM message m
      WHERE m.room_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2
    `,
    [roomId, limit]
  );

  const messageIds = rows.map((r) => r.id);
  if (messageIds.length === 0) return [];

  const segs = await db.many(
    `
      SELECT
        message_id,
        segment_text as text,
        language_code as language,
        is_error,
        error_type,
        correction,
        error_explanation,
        char_start,
        char_end,
        segment_index
      FROM message_segment
      WHERE message_id = ANY($1::uuid[])
      ORDER BY message_id, segment_index ASC
    `,
    [messageIds]
  );

  const byMessage = new Map();
  for (const s of segs) {
    const list = byMessage.get(s.message_id) || [];
    list.push({
      text: s.text,
      language: s.language,
      is_error: s.is_error,
      error_type: s.error_type,
      correction: s.correction,
      error_explanation: s.error_explanation,
      char_start: s.char_start,
      char_end: s.char_end,
    });
    byMessage.set(s.message_id, list);
  }

  // Return chronological order (oldest -> newest)
  return rows
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      sender_role: m.sender_role,
      raw_text: m.raw_text,
      created_at: m.created_at,
      segments: byMessage.get(m.id) || [],
    }));
}

/**
 * Check if unit assignment should be triggered
 */
export async function checkUnitAssignmentTrigger(studentId, language) {
  // Get recent messages
  const recentMessages = await db.many(
    `
      SELECT ma.identified_gaps, ma.should_trigger_unit
      FROM message m
      JOIN message_analysis ma ON m.id = ma.message_id
      WHERE m.sender_id = $1 AND m.sender_role = 'student'
      ORDER BY m.created_at DESC
      LIMIT 5
    `,
    [studentId]
  );

  // If last message should trigger, or pattern of gaps emerges
  const hasTrigger = recentMessages.some(m => m.should_trigger_unit);

  if (hasTrigger) {
    // Call computeNextUnits
    const { computeNextUnits } = await import('./curriculum.service.js');
    const nextUnits = await computeNextUnits(studentId, language);

    if (nextUnits.length > 0) {
      return nextUnits[0]; // Return first recommended unit
    }
  }

  return null;
}

export default {
  processStudentMessage,
  getConversationWithSegments,
  checkUnitAssignmentTrigger
};
