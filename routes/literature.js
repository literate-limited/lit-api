/**
 * Literature Routes
 * Migrated from lit-bloated/server/routes/literaturesea.routes.js
 * Literature/book content delivery
 */

import { Router } from 'express';
import { brandResolver } from '../middleware/brandResolver.js';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Candidate directories for literature content
const CANDIDATE_DIRS = [
  process.env.LITERATURE_DIR && path.resolve(process.env.LITERATURE_DIR),
  path.resolve(process.cwd(), '..', 'literature_books'),
  path.resolve(process.cwd(), 'literature_books')
].filter(Boolean);

// Helper to read JSON if exists
async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Find books root directory
async function booksRoot() {
  for (const dir of CANDIDATE_DIRS) {
    try {
      const stats = await fs.stat(dir);
      if (stats.isDirectory()) {
        return dir;
      }
    } catch {
      // Try next
    }
  }
  return null;
}

// Load book metadata
async function loadBookMeta(dirPath, id) {
  const meta = (await readJsonIfExists(path.join(dirPath, 'meta.json'))) || {};
  const book = (await readJsonIfExists(path.join(dirPath, 'book.json'))) || {};

  const authors =
    Array.isArray(meta.authors) && meta.authors.length > 0
      ? meta.authors
      : Array.isArray(book.authors)
      ? book.authors
      : [];

  return {
    id: Number.isFinite(Number(id)) ? Number(id) : id,
    title: meta.title || book.title || `Book ${id}`,
    authors,
    subjects: book.subjects || [],
    languages: book.languages || [],
    wordCount: meta.wordCount || null,
    estimatedMinutes: meta.estimatedMinutes || null,
    processedAt: meta.processedAt || null
  };
}

// List books
router.get('/books', async (req, res) => {
  const root = await booksRoot();
  if (!root) {
    return res.status(500).json({
      success: false,
      error: 'LITERATURE_DIR_NOT_FOUND',
      message: 'Literature books directory is missing. Set LITERATURE_DIR.'
    });
  }

  const query = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const bookDirs = entries.filter((ent) => ent.isDirectory());

    const metas = await Promise.all(
      bookDirs.map(async (ent) => {
        const dirPath = path.join(root, ent.name);
        try {
          return await loadBookMeta(dirPath, ent.name);
        } catch {
          return null;
        }
      })
    );

    const filtered = metas
      .filter(Boolean)
      .filter((b) => {
        if (!query) return true;
        const haystack = [
          b.title || '',
          ...(Array.isArray(b.authors) ? b.authors.map((a) => (a.name ? a.name : a)) : [])
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    res.json({
      success: true,
      total: filtered.length,
      books: filtered.slice(offset, offset + limit),
      hasMore: offset + limit < filtered.length
    });
  } catch (err) {
    console.error('Failed to list literature books:', err);
    res.status(500).json({
      success: false,
      error: 'LITERATURE_LIST_FAILED',
      message: 'Unable to read books directory.'
    });
  }
});

// Get single book
router.get('/books/:id', async (req, res) => {
  const root = await booksRoot();
  if (!root) {
    return res.status(500).json({
      success: false,
      error: 'LITERATURE_DIR_NOT_FOUND',
      message: 'Literature books directory is missing. Set LITERATURE_DIR.'
    });
  }

  const safeId = String(req.params.id || '').replace(/[^0-9A-Za-z_-]/g, '');
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'INVALID_ID' });
  }

  const dirPath = path.join(root, safeId);
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      return res.status(404).json({ success: false, error: 'BOOK_NOT_FOUND' });
    }
  } catch {
    return res.status(404).json({ success: false, error: 'BOOK_NOT_FOUND' });
  }

  try {
    const book = await loadBookMeta(dirPath, safeId);
    let text = null;
    let hasText = false;
    const includeText =
      String(req.query.includeText || req.query.text || '').toLowerCase() === 'true' ||
      String(req.query.includeText || req.query.text || '') === '1';

    const textPath = path.join(dirPath, 'text.txt');
    try {
      const stats = await fs.stat(textPath);
      hasText = stats.isFile();
      if (includeText && hasText) {
        text = await fs.readFile(textPath, 'utf8');
        // Limit text size in response
        if (text.length > 100000) {
          text = text.substring(0, 100000) + '\n\n[Content truncated...]';
        }
      }
    } catch (err) {
      hasText = false;
    }

    // Get chapters if available
    let chapters = [];
    try {
      const chaptersPath = path.join(dirPath, 'chapters.json');
      const chaptersData = await readJsonIfExists(chaptersPath);
      if (chaptersData && Array.isArray(chaptersData.chapters)) {
        chapters = chaptersData.chapters;
      }
    } catch {
      // No chapters file
    }

    res.json({
      success: true,
      book: { ...book, hasText, chapters },
      text: text ?? undefined
    });
  } catch (err) {
    console.error(`Failed to load literature book ${safeId}:`, err);
    res.status(500).json({
      success: false,
      error: 'LITERATURE_LOAD_FAILED'
    });
  }
});

// Get book chapter
router.get('/books/:id/chapters/:chapterId', async (req, res) => {
  const root = await booksRoot();
  if (!root) {
    return res.status(500).json({
      success: false,
      error: 'LITERATURE_DIR_NOT_FOUND'
    });
  }

  const safeId = String(req.params.id || '').replace(/[^0-9A-Za-z_-]/g, '');
  const chapterId = String(req.params.chapterId || '').replace(/[^0-9A-Za-z_-]/g, '');
  
  if (!safeId || !chapterId) {
    return res.status(400).json({ success: false, error: 'INVALID_ID' });
  }

  try {
    const dirPath = path.join(root, safeId);
    const chapterPath = path.join(dirPath, 'chapters', `${chapterId}.txt`);
    
    const text = await fs.readFile(chapterPath, 'utf8');
    
    res.json({
      success: true,
      chapterId,
      text
    });
  } catch (err) {
    res.status(404).json({
      success: false,
      error: 'CHAPTER_NOT_FOUND'
    });
  }
});

export default router;
