/**
 * Eagle Routes
 * Migrated from lit-bloated/server/routes/eagle.routes.js
 * Project management for Eagle (research/writing tool)
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// All routes require authentication
router.use(verifyToken);

// Create project
router.post('/projects', async (req, res) => {
  try {
    const { title, description, type = 'research', metadata = {} } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'TITLE_REQUIRED',
        message: 'Project title is required'
      });
    }

    const id = uuidv4();
    const project = await db.query(
      `INSERT INTO eagle_projects (id, user_id, brand_id, title, description, type, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       RETURNING *`,
      [id, req.user.id, req.brandId, title, description || null, type, JSON.stringify(metadata)]
    );

    res.status(201).json({
      success: true,
      project: project.rows[0]
    });
  } catch (err) {
    console.error('Eagle create project error:', err);
    res.status(500).json({
      success: false,
      error: 'CREATE_PROJECT_FAILED',
      message: err.message
    });
  }
});

// List projects
router.get('/projects', async (req, res) => {
  try {
    const { status, type } = req.query;
    
    let query = `SELECT * FROM eagle_projects 
                 WHERE user_id = $1 AND brand_id = $2`;
    const values = [req.user.id, req.brandId];
    
    if (status) {
      query += ` AND status = $${values.length + 1}`;
      values.push(status);
    }
    
    if (type) {
      query += ` AND type = $${values.length + 1}`;
      values.push(type);
    }
    
    query += ` ORDER BY updated_at DESC`;

    const projects = await db.many(query, values);

    res.json({
      success: true,
      projects: projects.map(p => ({
        ...p,
        metadata: JSON.parse(p.metadata || '{}')
      }))
    });
  } catch (err) {
    console.error('Eagle list projects error:', err);
    res.status(500).json({
      success: false,
      error: 'LIST_PROJECTS_FAILED',
      message: err.message
    });
  }
});

// Get single project
router.get('/projects/:id', async (req, res) => {
  try {
    const project = await db.one(
      `SELECT * FROM eagle_projects 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [req.params.id, req.user.id, req.brandId]
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'PROJECT_NOT_FOUND'
      });
    }

    // Get project documents/sections
    const documents = await db.many(
      `SELECT * FROM eagle_documents 
       WHERE project_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );

    res.json({
      success: true,
      project: {
        ...project,
        metadata: JSON.parse(project.metadata || '{}'),
        documents: documents.map(d => ({
          ...d,
          content: d.content // Truncate if too large in production
        }))
      }
    });
  } catch (err) {
    console.error('Eagle get project error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_PROJECT_FAILED',
      message: err.message
    });
  }
});

// Update project
router.put('/projects/:id', async (req, res) => {
  try {
    const { title, description, status, metadata } = req.body;

    // Verify ownership
    const existing = await db.one(
      `SELECT * FROM eagle_projects 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [req.params.id, req.user.id, req.brandId]
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'PROJECT_NOT_FOUND'
      });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description);
    }
    if (status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(status);
    }
    if (metadata !== undefined) {
      updates.push(`metadata = $${idx++}`);
      values.push(JSON.stringify(metadata));
    }

    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const result = await db.query(
      `UPDATE eagle_projects SET ${updates.join(', ')} 
       WHERE id = $${idx}
       RETURNING *`,
      values
    );

    res.json({
      success: true,
      project: {
        ...result.rows[0],
        metadata: JSON.parse(result.rows[0].metadata || '{}')
      }
    });
  } catch (err) {
    console.error('Eagle update project error:', err);
    res.status(500).json({
      success: false,
      error: 'UPDATE_PROJECT_FAILED',
      message: err.message
    });
  }
});

// Delete project
router.delete('/projects/:id', async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM eagle_projects 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [req.params.id, req.user.id, req.brandId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'PROJECT_NOT_FOUND'
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Eagle delete project error:', err);
    res.status(500).json({
      success: false,
      error: 'DELETE_PROJECT_FAILED',
      message: err.message
    });
  }
});

// Add document to project
router.post('/projects/:id/documents', async (req, res) => {
  try {
    const { title, content, type = 'draft' } = req.body;
    const projectId = req.params.id;

    // Verify project ownership
    const project = await db.one(
      `SELECT id FROM eagle_projects 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [projectId, req.user.id, req.brandId]
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'PROJECT_NOT_FOUND'
      });
    }

    const id = uuidv4();
    const document = await db.query(
      `INSERT INTO eagle_documents (id, project_id, title, content, type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, projectId, title || 'Untitled', content || '', type]
    );

    // Update project's updated_at
    await db.query(
      'UPDATE eagle_projects SET updated_at = NOW() WHERE id = $1',
      [projectId]
    );

    res.status(201).json({
      success: true,
      document: document.rows[0]
    });
  } catch (err) {
    console.error('Eagle create document error:', err);
    res.status(500).json({
      success: false,
      error: 'CREATE_DOCUMENT_FAILED',
      message: err.message
    });
  }
});

export default router;
