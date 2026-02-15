/**
 * ML Routes
 * Proxy routes to Python ML service
 */

import express from 'express';
import mlService from '../services/ml-service.js';

const router = express.Router();

/**
 * ML Health Check
 */
router.get('/health', async (req, res) => {
  const health = await mlService.healthCheck();
  res.json(health);
});

/**
 * Proxy all ML requests to Python service
 */
router.all('/*', async (req, res) => {
  if (!mlService.ready()) {
    return res.status(503).json({
      error: 'ML service unavailable',
      message: 'The ML service is not ready yet'
    });
  }

  try {
    const mlUrl = `${mlService.getUrl()}${req.path}`;

    // Prepare fetch options
    const options = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...req.headers
      }
    };

    // Add body for non-GET requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      options.body = JSON.stringify(req.body);
    }

    // Forward request to ML service
    const response = await fetch(mlUrl, options);
    const data = await response.json();

    // Forward response
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[ML Proxy] Error:', error);
    res.status(500).json({
      error: 'ML service error',
      message: error.message
    });
  }
});

export default router;
