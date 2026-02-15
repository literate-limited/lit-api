/**
 * Feed Routes
 * Migrated from lit-bloated/server/routes/feed.routes.js
 * Social feed functionality
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Get global/class feed
router.get('/', verifyToken, async (req, res) => {
  try {
    const { classId, limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;

    let posts;
    
    if (classId) {
      // Get class-specific feed
      posts = await db.many(
        `SELECT 
          p.*,
          u.first_name as author_first_name,
          u.last_name as author_last_name,
          (SELECT COUNT(*) FROM feed_likes WHERE post_id = p.id) as likes_count,
          (SELECT COUNT(*) FROM feed_comments WHERE post_id = p.id) as comments_count,
          EXISTS(SELECT 1 FROM feed_likes WHERE post_id = p.id AND user_id = $1) as has_liked
         FROM feed_posts p
         JOIN users u ON u.id = p.user_id
         WHERE p.class_id = $2 AND p.brand_id = $3
         ORDER BY p.created_at DESC
         LIMIT $4 OFFSET $5`,
        [userId, classId, req.brandId, limit, offset]
      );
    } else {
      // Get global feed (posts from user's classes or public posts)
      posts = await db.many(
        `SELECT 
          p.*,
          u.first_name as author_first_name,
          u.last_name as author_last_name,
          (SELECT COUNT(*) FROM feed_likes WHERE post_id = p.id) as likes_count,
          (SELECT COUNT(*) FROM feed_comments WHERE post_id = p.id) as comments_count,
          EXISTS(SELECT 1 FROM feed_likes WHERE post_id = p.id AND user_id = $1) as has_liked
         FROM feed_posts p
         JOIN users u ON u.id = p.user_id
         WHERE p.brand_id = $2 AND (
           p.visibility = 'public' 
           OR p.user_id = $1
           OR p.class_id IN (SELECT class_id FROM enrollments WHERE student_id = $1)
         )
         ORDER BY p.created_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, req.brandId, limit, offset]
      );
    }

    res.json({
      success: true,
      posts: posts.map(p => ({
        ...p,
        content: JSON.parse(p.content || '{}')
      }))
    });
  } catch (err) {
    console.error('Get feed error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_FEED_FAILED',
      message: err.message
    });
  }
});

// Get user's feed
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    const posts = await db.many(
      `SELECT 
        p.*,
        u.first_name as author_first_name,
        u.last_name as author_last_name,
        (SELECT COUNT(*) FROM feed_likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM feed_comments WHERE post_id = p.id) as comments_count
       FROM feed_posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1 AND p.brand_id = $2 AND p.visibility != 'private'
       ORDER BY p.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, req.brandId, limit, offset]
    );

    res.json({
      success: true,
      posts: posts.map(p => ({
        ...p,
        content: JSON.parse(p.content || '{}')
      }))
    });
  } catch (err) {
    console.error('Get user feed error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_USER_FEED_FAILED',
      message: err.message
    });
  }
});

// Create post
router.post('/', verifyToken, async (req, res) => {
  try {
    const { content, type = 'text', classId, visibility = 'public', metadata = {} } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'CONTENT_REQUIRED'
      });
    }

    const id = uuidv4();
    const post = await db.query(
      `INSERT INTO feed_posts (id, user_id, brand_id, class_id, type, content, visibility, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, req.user.id, req.brandId, classId || null, type, 
       JSON.stringify(content), visibility, JSON.stringify(metadata)]
    );

    res.status(201).json({
      success: true,
      post: {
        ...post.rows[0],
        content: JSON.parse(post.rows[0].content)
      }
    });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({
      success: false,
      error: 'CREATE_POST_FAILED',
      message: err.message
    });
  }
});

// Like/unlike post
router.post('/:postId/like', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    // Check if already liked
    const existing = await db.one(
      'SELECT id FROM feed_likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    if (existing) {
      // Unlike
      await db.query(
        'DELETE FROM feed_likes WHERE post_id = $1 AND user_id = $2',
        [postId, userId]
      );
      
      res.json({
        success: true,
        liked: false
      });
    } else {
      // Like
      const id = uuidv4();
      await db.query(
        'INSERT INTO feed_likes (id, post_id, user_id) VALUES ($1, $2, $3)',
        [id, postId, userId]
      );
      
      res.json({
        success: true,
        liked: true
      });
    }
  } catch (err) {
    console.error('Toggle like error:', err);
    res.status(500).json({
      success: false,
      error: 'LIKE_FAILED',
      message: err.message
    });
  }
});

// Add comment
router.post('/:postId/comments', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'COMMENT_TEXT_REQUIRED'
      });
    }

    const id = uuidv4();
    const comment = await db.query(
      `INSERT INTO feed_comments (id, post_id, user_id, text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, postId, req.user.id, text.trim()]
    );

    res.status(201).json({
      success: true,
      comment: comment.rows[0]
    });
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({
      success: false,
      error: 'ADD_COMMENT_FAILED',
      message: err.message
    });
  }
});

// Get post comments
router.get('/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;

    const comments = await db.many(
      `SELECT 
        c.*,
        u.first_name as author_first_name,
        u.last_name as author_last_name
       FROM feed_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId]
    );

    res.json({
      success: true,
      comments
    });
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_COMMENTS_FAILED',
      message: err.message
    });
  }
});

export default router;
