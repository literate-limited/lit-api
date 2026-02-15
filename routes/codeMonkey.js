/**
 * Code Monkey Routes
 * Migrated from lit-bloated/server/routes/codeMonkey.routes.js
 * AI coding assistant with credit charges
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { chargeCredits } from '../services/credits.service.js';
import { getCompletion } from '../services/openai.service.js';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Chat with Code Monkey
router.post('/chat', verifyToken, async (req, res) => {
  try {
    const { message, code, language = 'javascript', context = [] } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_MESSAGE',
        message: 'Message is required'
      });
    }

    // Check/charge credits (1 credit per request)
    const chargeResult = await chargeCredits({
      userId: req.user.id,
      brandId: req.brandId,
      amount: 1,
      description: 'Code Monkey chat request',
      metadata: { language }
    });

    if (!chargeResult.success) {
      return res.status(402).json({
        success: false,
        error: 'INSUFFICIENT_CREDITS',
        message: chargeResult.message || 'Not enough credits'
      });
    }

    // Build system prompt for Code Monkey
    const systemPrompt = `You are Code Monkey, an expert programming assistant specialized in ${language}.
You help users write clean, efficient, and well-documented code.
Always provide explanations alongside code examples.
If the user provides code, analyze it and suggest improvements if applicable.`;

    // Build user prompt
    let userPrompt = message;
    if (code) {
      userPrompt += `\n\nHere is my code:\n\`\`\`${language}\n${code}\n\`\`\``;
    }

    // Get AI response
    const completion = await getCompletion({
      systemPrompt,
      userPrompt,
      context: context.slice(-5), // Keep last 5 messages for context
      temperature: 0.7,
      maxTokens: 2000
    });

    res.json({
      success: true,
      response: completion.text,
      creditsRemaining: chargeResult.remainingCredits,
      usage: completion.usage
    });
  } catch (err) {
    console.error('Code Monkey chat error:', err);
    res.status(500).json({
      success: false,
      error: 'CHAT_FAILED',
      message: err.message
    });
  }
});

// Explain code
router.post('/explain', verifyToken, async (req, res) => {
  try {
    const { code, language = 'javascript' } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CODE',
        message: 'Code is required'
      });
    }

    // Check/charge credits (1 credit per request)
    const chargeResult = await chargeCredits({
      userId: req.user.id,
      brandId: req.brandId,
      amount: 1,
      description: 'Code Monkey explain code',
      metadata: { language }
    });

    if (!chargeResult.success) {
      return res.status(402).json({
        success: false,
        error: 'INSUFFICIENT_CREDITS',
        message: chargeResult.message
      });
    }

    const systemPrompt = `You are Code Monkey, an expert programming tutor.
Explain the provided code in clear, simple terms. Break down:
1. What the code does overall
2. Key functions/components
3. Any important patterns or techniques used`;

    const userPrompt = `Please explain this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\``;

    const completion = await getCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0.5,
      maxTokens: 1500
    });

    res.json({
      success: true,
      explanation: completion.text,
      creditsRemaining: chargeResult.remainingCredits
    });
  } catch (err) {
    console.error('Code Monkey explain error:', err);
    res.status(500).json({
      success: false,
      error: 'EXPLAIN_FAILED',
      message: err.message
    });
  }
});

// Review code
router.post('/review', verifyToken, async (req, res) => {
  try {
    const { code, language = 'javascript' } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CODE',
        message: 'Code is required'
      });
    }

    // Check/charge credits (2 credits for code review)
    const chargeResult = await chargeCredits({
      userId: req.user.id,
      brandId: req.brandId,
      amount: 2,
      description: 'Code Monkey code review',
      metadata: { language }
    });

    if (!chargeResult.success) {
      return res.status(402).json({
        success: false,
        error: 'INSUFFICIENT_CREDITS',
        message: chargeResult.message
      });
    }

    const systemPrompt = `You are Code Monkey, a senior code reviewer.
Review the provided code and provide:
1. Overall assessment
2. Code quality issues (if any)
3. Security concerns (if any)
4. Performance suggestions
5. Best practices not being followed
6. Positive aspects of the code

Be constructive and specific.`;

    const userPrompt = `Please review this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\``;

    const completion = await getCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0.4,
      maxTokens: 2000
    });

    res.json({
      success: true,
      review: completion.text,
      creditsRemaining: chargeResult.remainingCredits
    });
  } catch (err) {
    console.error('Code Monkey review error:', err);
    res.status(500).json({
      success: false,
      error: 'REVIEW_FAILED',
      message: err.message
    });
  }
});

export default router;
