import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { verifyToken } from '../middleware/auth.js';
import { translateText } from '../services/translate.service.js';

const router = Router();

router.use(brandResolver);
router.use(verifyToken);

function normalizeLang(code) {
  if (!code) return null;
  return String(code).trim().toLowerCase();
}

// List threads for the authenticated user
router.get('/threads', async (req, res) => {
  try {
    const threads = await db.many(
      `
      SELECT
        t.id,
        t.kind,
        t.title,
        t.updated_at,
        (
          SELECT json_agg(json_build_object(
            'id', u.id,
            'firstName', u.first_name,
            'lastName', u.last_name,
            'email', u.email
          ) ORDER BY u.first_name, u.last_name)
          FROM chat_thread_members m
          JOIN users u ON u.id = m.user_id
          WHERE m.thread_id = t.id AND m.brand_id = $2
        ) as members,
        (
          SELECT json_build_object(
            'id', cm.id,
            'senderId', cm.sender_id,
            'kind', cm.kind,
            'originalLanguage', cm.original_language,
            'originalText', cm.original_text,
            'createdAt', cm.created_at
          )
          FROM chat_messages cm
          WHERE cm.thread_id = t.id AND cm.brand_id = $2
          ORDER BY cm.created_at DESC
          LIMIT 1
        ) as lastMessage
      FROM chat_threads t
      JOIN chat_thread_members tm ON tm.thread_id = t.id
      WHERE tm.user_id = $1 AND tm.brand_id = $2 AND t.brand_id = $2
      ORDER BY t.updated_at DESC
      LIMIT 200
      `,
      [req.user.id, req.brandId]
    );

    res.json({ success: true, threads });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create or get a DM thread between current user and another user (within same brand)
router.post('/threads/dm', async (req, res) => {
  try {
    const otherUserId = String(req.body?.userId || '').trim();
    if (!otherUserId) {
      return res.status(400).json({ success: false, error: 'userId required' });
    }
    if (otherUserId === req.user.id) {
      return res.status(400).json({ success: false, error: 'Cannot DM yourself' });
    }

    // Verify other user is in the same brand
    const other = await db.one(
      'SELECT id FROM users WHERE id = $1 AND brand_id = $2',
      [otherUserId, req.brandId]
    );
    if (!other) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Find an existing dm thread containing exactly these two users
    const existing = await db.one(
      `
      SELECT t.id
      FROM chat_threads t
      WHERE t.kind = 'dm' AND t.brand_id = $3
        AND EXISTS (
          SELECT 1 FROM chat_thread_members m
          WHERE m.thread_id = t.id AND m.user_id = $1 AND m.brand_id = $3
        )
        AND EXISTS (
          SELECT 1 FROM chat_thread_members m
          WHERE m.thread_id = t.id AND m.user_id = $2 AND m.brand_id = $3
        )
        AND (
          SELECT COUNT(*) FROM chat_thread_members m
          WHERE m.thread_id = t.id AND m.brand_id = $3
        ) = 2
      LIMIT 1
      `,
      [req.user.id, otherUserId, req.brandId]
    );

    if (existing?.id) {
      return res.json({ success: true, threadId: existing.id, created: false });
    }

    const threadId = uuidv4();
    await db.tx(async (tx) => {
      await tx.query(
        `
        INSERT INTO chat_threads (id, brand_id, kind, created_by)
        VALUES ($1, $2, 'dm', $3)
        `,
        [threadId, req.brandId, req.user.id]
      );
      await tx.query(
        `
        INSERT INTO chat_thread_members (thread_id, user_id, brand_id, role)
        VALUES ($1, $2, $3, 'admin'), ($1, $4, $3, 'member')
        `,
        [threadId, req.user.id, req.brandId, otherUserId]
      );
    });

    res.json({ success: true, threadId, created: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch messages in a thread (cursor-based)
router.get('/threads/:threadId/messages', async (req, res) => {
  try {
    const { threadId } = req.params;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const preferLang = normalizeLang(req.query.preferLang);

    // Verify membership
    const member = await db.one(
      `
      SELECT 1
      FROM chat_thread_members
      WHERE thread_id = $1 AND user_id = $2 AND brand_id = $3
      `,
      [threadId, req.user.id, req.brandId]
    );
    if (!member) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const rows = await db.many(
      `
      SELECT
        m.id,
        m.thread_id as "threadId",
        m.sender_id as "senderId",
        u.first_name as "senderFirstName",
        u.last_name as "senderLastName",
        m.kind,
        m.original_language as "originalLanguage",
        m.original_text as "originalText",
        m.metadata,
        m.created_at as "createdAt",
        (
          SELECT json_object_agg(t.language_code, t.translated_text)
          FROM chat_message_translations t
          WHERE t.message_id = m.id AND t.brand_id = $3
        ) as translations,
        (
          SELECT t.translated_text
          FROM chat_message_translations t
          WHERE t.message_id = m.id AND t.brand_id = $3 AND t.language_code = $4
          LIMIT 1
        ) as "preferredText"
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.thread_id = $1 AND m.brand_id = $3
        AND ($2::timestamptz IS NULL OR m.created_at < $2::timestamptz)
      ORDER BY m.created_at DESC
      LIMIT $5
      `,
      [threadId, before ? before.toISOString() : null, req.brandId, preferLang, limit]
    );

    // Return ascending for UI convenience
    const messages = rows.reverse();
    const nextCursor = rows.length ? rows[rows.length - 1].createdAt : null;

    res.json({ success: true, messages, nextCursor });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send a text message (optionally request translation)
router.post('/threads/:threadId/messages', async (req, res) => {
  try {
    const { threadId } = req.params;
    const text = String(req.body?.text || '').trim();
    const originalLanguage = normalizeLang(req.body?.originalLanguage) || null;
    const translateTo = Array.isArray(req.body?.translateTo)
      ? req.body.translateTo.map(normalizeLang).filter(Boolean)
      : [];

    if (!text) {
      return res.status(400).json({ success: false, error: 'text required' });
    }

    // Verify membership
    const member = await db.one(
      `
      SELECT 1
      FROM chat_thread_members
      WHERE thread_id = $1 AND user_id = $2 AND brand_id = $3
      `,
      [threadId, req.user.id, req.brandId]
    );
    if (!member) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const messageId = uuidv4();

    // Insert message and bump thread updated_at
    await db.tx(async (tx) => {
      await tx.query(
        `
        INSERT INTO chat_messages (id, thread_id, brand_id, sender_id, kind, original_language, original_text)
        VALUES ($1, $2, $3, $4, 'text', $5, $6)
        `,
        [messageId, threadId, req.brandId, req.user.id, originalLanguage, text]
      );
      await tx.query(
        `UPDATE chat_threads SET updated_at = NOW() WHERE id = $1 AND brand_id = $2`,
        [threadId, req.brandId]
      );
    });

    // Translate (best-effort) and cache
    const translations = {};
    for (const lang of translateTo) {
      if (lang === originalLanguage) continue;
      const translated = await translateText({
        text,
        from: originalLanguage,
        to: lang
      });
      if (translated?.text) {
        translations[lang] = translated.text;
        await db.query(
          `
          INSERT INTO chat_message_translations (message_id, brand_id, language_code, translated_text, provider)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (message_id, language_code)
          DO UPDATE SET translated_text = EXCLUDED.translated_text, provider = EXCLUDED.provider
          `,
          [messageId, req.brandId, lang, translated.text, translated.provider || null]
        );
      }
    }

    res.json({
      success: true,
      message: {
        id: messageId,
        threadId,
        senderId: req.user.id,
        kind: 'text',
        originalLanguage,
        originalText: text,
        createdAt: new Date().toISOString(),
        translations
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

