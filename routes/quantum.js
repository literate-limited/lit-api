/**
 * Quantum Routes
 * Migrated from lit-bloated/server/routes/quantum.routes.js
 * Quantum computing simulation tasks
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Rate limiting helper
const taskLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

function checkRateLimit(userId) {
  const now = Date.now();
  const userTasks = taskLimits.get(userId) || [];
  
  // Clean old entries
  const validTasks = userTasks.filter(t => now - t < RATE_LIMIT_WINDOW);
  
  if (validTasks.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  
  validTasks.push(now);
  taskLimits.set(userId, validTasks);
  return true;
}

// Run quantum task
router.post('/run', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (!checkRateLimit(userId)) {
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many quantum tasks. Please wait a minute.'
      });
    }

    const { circuit, shots = 1024, backend = 'simulator' } = req.body;

    if (!circuit) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CIRCUIT',
        message: 'Quantum circuit is required'
      });
    }

    // Validate backend (only simulator allowed in MVP)
    if (backend !== 'simulator') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_BACKEND',
        message: 'Only simulator backend is available in MVP'
      });
    }

    const taskId = uuidv4();
    
    // Create task record
    await db.query(
      `INSERT INTO quantum_tasks (id, user_id, brand_id, circuit, shots, backend, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
      [taskId, userId, req.brandId, JSON.stringify(circuit), shots, backend]
    );

    // Simulate quantum computation (async)
    simulateQuantumTask(taskId, circuit, shots);

    res.json({
      success: true,
      taskId,
      status: 'pending',
      message: 'Quantum task submitted'
    });
  } catch (err) {
    console.error('Quantum run error:', err);
    res.status(500).json({
      success: false,
      error: 'QUANTUM_RUN_FAILED',
      details: err.message
    });
  }
});

// Get task status
router.get('/status/:taskId', verifyToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    const task = await db.one(
      `SELECT * FROM quantum_tasks 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [taskId, userId, req.brandId]
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'TASK_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      taskId: task.id,
      status: task.status,
      createdAt: task.created_at,
      completedAt: task.completed_at
    });
  } catch (err) {
    console.error('Quantum status error:', err);
    res.status(500).json({
      success: false,
      error: 'QUANTUM_STATUS_FAILED',
      details: err.message
    });
  }
});

// Get task result
router.get('/result/:taskId', verifyToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    const task = await db.one(
      `SELECT * FROM quantum_tasks 
       WHERE id = $1 AND user_id = $2 AND brand_id = $3`,
      [taskId, userId, req.brandId]
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'TASK_NOT_FOUND'
      });
    }

    if (task.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'TASK_NOT_COMPLETED',
        status: task.status
      });
    }

    res.json({
      success: true,
      taskId: task.id,
      result: JSON.parse(task.result || '{}'),
      counts: JSON.parse(task.counts || '{}'),
      executionTime: task.execution_time
    });
  } catch (err) {
    console.error('Quantum result error:', err);
    res.status(500).json({
      success: false,
      error: 'QUANTUM_RESULT_FAILED',
      details: err.message
    });
  }
});

// List user's tasks
router.get('/tasks', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const tasks = await db.many(
      `SELECT id, status, circuit, shots, backend, created_at, completed_at
       FROM quantum_tasks 
       WHERE user_id = $1 AND brand_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, req.brandId, limit]
    );

    res.json({
      success: true,
      tasks: tasks.map(t => ({
        ...t,
        circuit: JSON.parse(t.circuit || '{}')
      }))
    });
  } catch (err) {
    console.error('Quantum list error:', err);
    res.status(500).json({
      success: false,
      error: 'QUANTUM_LIST_FAILED',
      details: err.message
    });
  }
});

// Simulate quantum computation (async background processing)
async function simulateQuantumTask(taskId, circuit, shots) {
  const startTime = Date.now();
  
  try {
    // Simple quantum simulation (placeholder for actual quantum computation)
    // In production, this would interface with Qiskit, Cirq, or similar
    const numQubits = circuit.numQubits || 2;
    const counts = {};
    
    // Generate random measurement outcomes based on circuit
    for (let i = 0; i < shots; i++) {
      const outcome = Math.floor(Math.random() * Math.pow(2, numQubits))
        .toString(2)
        .padStart(numQubits, '0');
      counts[outcome] = (counts[outcome] || 0) + 1;
    }

    const executionTime = Date.now() - startTime;

    // Update task with results
    await db.query(
      `UPDATE quantum_tasks 
       SET status = 'completed', 
           result = $1, 
           counts = $2, 
           execution_time = $3,
           completed_at = NOW()
       WHERE id = $4`,
      [
        JSON.stringify({ numQubits, shots, backend: 'simulator' }),
        JSON.stringify(counts),
        executionTime,
        taskId
      ]
    );
  } catch (error) {
    console.error('Quantum simulation error:', error);
    
    await db.query(
      `UPDATE quantum_tasks 
       SET status = 'failed', 
           error = $1,
           completed_at = NOW()
       WHERE id = $2`,
      [error.message, taskId]
    );
  }
}

export default router;
