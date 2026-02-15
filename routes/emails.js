/**
 * Email Routes
 * Migrated from lit-bloated/server/routes/email.routes.js
 * Email sending functionality
 */

import { Router } from 'express';
import { brandResolver } from '../middleware/brandResolver.js';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Send feedback email
router.post('/feedback', async (req, res) => {
  try {
    const { name, email, subject, message, type = 'general' } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'Name, email, and message are required'
      });
    }

    // In production, integrate with email service (SendGrid, AWS SES, etc.)
    // For now, log and return success
    console.log('Feedback received:', {
      name,
      email,
      subject,
      message: message.substring(0, 200),
      type,
      brandId: req.brandId,
      timestamp: new Date().toISOString()
    });

    // TODO: Send email using configured provider
    // await sendEmail({
    //   to: process.env.FEEDBACK_EMAIL || 'feedback@litlang.com',
    //   from: email,
    //   subject: `[${type}] ${subject || 'Feedback'}`,
    //   text: `From: ${name} <${email}>\n\n${message}`
    // });

    res.json({
      success: true,
      message: 'Feedback sent successfully'
    });
  } catch (err) {
    console.error('Send feedback error:', err);
    res.status(500).json({
      success: false,
      error: 'SEND_FEEDBACK_FAILED',
      message: err.message
    });
  }
});

// Send contact form email
router.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message, category } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS'
      });
    }

    console.log('Contact form submission:', {
      name,
      email,
      subject,
      category,
      brandId: req.brandId,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Message sent successfully'
    });
  } catch (err) {
    console.error('Send contact error:', err);
    res.status(500).json({
      success: false,
      error: 'SEND_CONTACT_FAILED',
      message: err.message
    });
  }
});

export default router;
