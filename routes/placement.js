/**
 * Placement Routes
 * Migrated from lit-bloated/server/routes/placement.routes.js
 * Placement tests for class enrollment and skill assessment
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { brandResolver } from '../middleware/brandResolver.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// All placement routes require authentication
router.use(verifyToken);

// Get placement test for a class
router.get('/class/:classId/test', async (req, res) => {
  try {
    const { classId } = req.params;

    // Verify class exists
    const classData = await db.one(
      'SELECT * FROM classes WHERE id = $1 AND brand_id = $2',
      [classId, req.brandId]
    );

    if (!classData) {
      return res.status(404).json({
        success: false,
        error: 'CLASS_NOT_FOUND'
      });
    }

    // Get placement test questions for this class
    const questions = await db.many(
      `SELECT q.*
       FROM placement_test_questions ptq
       JOIN question q ON q.id = ptq.question_id
       WHERE ptq.class_id = $1
       ORDER BY ptq.question_order ASC`,
      [classId]
    );

    // If no custom questions, use default placement test
    let testQuestions = questions;
    if (questions.length === 0) {
      testQuestions = await db.many(
        `SELECT * FROM question
         WHERE type = 'placement' AND (brand_id = $1 OR brand_id IS NULL)
         ORDER BY RANDOM()
         LIMIT 10`,
        [req.brandId]
      );
    }

    res.json({
      success: true,
      test: {
        classId,
        className: classData.name,
        questions: testQuestions.map(q => ({
          id: q.id,
          prompt: q.prompt,
          type: q.type,
          options: q.options,
          metadata: JSON.parse(q.metadata || '{}')
        }))
      }
    });
  } catch (err) {
    console.error('Get placement test error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_TEST_FAILED',
      message: err.message
    });
  }
});

// Submit placement test
router.post('/class/:classId/submit', async (req, res) => {
  try {
    const { classId } = req.params;
    const { answers } = req.body;
    const studentId = req.user.id;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_ANSWERS',
        message: 'Answers array is required'
      });
    }

    // Calculate score
    let correctCount = 0;
    const gradedAnswers = [];

    for (const answer of answers) {
      const question = await db.one(
        'SELECT * FROM question WHERE id = $1',
        [answer.questionId]
      );

      const isCorrect = question &&
        question.correct_answer?.toLowerCase().trim() ===
        answer.answer?.toLowerCase().trim();

      if (isCorrect) correctCount++;

      gradedAnswers.push({
        questionId: answer.questionId,
        answer: answer.answer,
        correct: isCorrect,
        correctAnswer: question?.correct_answer
      });
    }

    const score = Math.round((correctCount / answers.length) * 100);
    
    // Determine recommended level
    let recommendedLevel = 'beginner';
    if (score >= 80) recommendedLevel = 'advanced';
    else if (score >= 60) recommendedLevel = 'intermediate';

    // Create enrollment record
    const enrollmentId = uuidv4();
    await db.query(
      `INSERT INTO enrollments (id, class_id, student_id, brand_id, placement_score, recommended_level)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (class_id, student_id) 
       DO UPDATE SET placement_score = $5, recommended_level = $6, updated_at = NOW()`,
      [enrollmentId, classId, studentId, req.brandId, score, recommendedLevel]
    );

    res.json({
      success: true,
      result: {
        score,
        totalQuestions: answers.length,
        correctAnswers: correctCount,
        recommendedLevel,
        gradedAnswers
      }
    });
  } catch (err) {
    console.error('Submit placement test error:', err);
    res.status(500).json({
      success: false,
      error: 'SUBMIT_TEST_FAILED',
      message: err.message
    });
  }
});

// Get enrollment status
router.get('/enrollment/:enrollmentId', async (req, res) => {
  try {
    const enrollment = await db.one(
      `SELECT e.*, c.name as class_name, c.teacher_id
       FROM enrollments e
       JOIN classes c ON c.id = e.class_id
       WHERE e.id = $1 AND e.student_id = $2 AND e.brand_id = $3`,
      [req.params.enrollmentId, req.user.id, req.brandId]
    );

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        error: 'ENROLLMENT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      enrollment: {
        id: enrollment.id,
        classId: enrollment.class_id,
        className: enrollment.class_name,
        placementScore: enrollment.placement_score,
        recommendedLevel: enrollment.recommended_level,
        status: enrollment.status,
        enrolledAt: enrollment.created_at
      }
    });
  } catch (err) {
    console.error('Get enrollment status error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_ENROLLMENT_FAILED',
      message: err.message
    });
  }
});

// Get math placement test
router.get('/math/test', async (req, res) => {
  try {
    const questions = await db.many(
      `SELECT * FROM question
       WHERE type = 'math_placement' AND brand_id = $1
       ORDER BY difficulty_score ASC
       LIMIT 15`,
      [req.brandId]
    );

    res.json({
      success: true,
      test: {
        subject: 'math',
        questions: questions.map(q => ({
          id: q.id,
          prompt: q.prompt,
          type: q.type,
          question_format: q.question_format,
          options: q.options,
          subject: q.subject,
          difficulty: q.difficulty
        }))
      }
    });
  } catch (err) {
    console.error('Get math placement error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_MATH_TEST_FAILED',
      message: err.message
    });
  }
});

// Submit math placement
router.post('/math/submit', async (req, res) => {
  try {
    const { answers } = req.body;

    // Similar grading logic as class placement
    let correctCount = 0;
    const gradedAnswers = [];

    for (const answer of answers) {
      const question = await db.one(
        'SELECT * FROM question WHERE id = $1',
        [answer.questionId]
      );

      // For MCQ, answer is the index (0, 1, 2, 3)
      // For other types, compare the answer text
      const isCorrect = question?.correct_answer?.toLowerCase().trim() ===
          answer.answer?.toLowerCase().trim();

      if (isCorrect) correctCount++;

      gradedAnswers.push({
        questionId: answer.questionId,
        userAnswer: answer.answer,
        correct: isCorrect,
        correctAnswer: question?.correct_answer,
        explanation: question?.explanation
      });
    }

    const score = Math.round((correctCount / answers.length) * 100);

    // Save math placement result
    await db.query(
      `INSERT INTO student_assessment (id, user_id, brand_id, subject, score, details)
       VALUES ($1, $2, $3, 'math', $4, $5)
       ON CONFLICT (user_id, subject)
       DO UPDATE SET score = $4, details = $5, assessed_at = NOW()`,
      [uuidv4(), req.user.id, req.brandId, score, JSON.stringify({ total: answers.length, correct: correctCount })]
    );

    res.json({
      success: true,
      score,
      totalQuestions: answers.length,
      correctAnswers: correctCount,
      recommendedLevel: score >= 80 ? 'expert' : score >= 60 ? 'hard' : score >= 40 ? 'medium' : score >= 20 ? 'easy' : 'beginner',
      gradedAnswers
    });
  } catch (err) {
    console.error('Submit math placement error:', err);
    res.status(500).json({
      success: false,
      error: 'SUBMIT_MATH_FAILED',
      message: err.message
    });
  }
});

// Get English CEFR placement test
router.get('/english-cefr/test', async (req, res) => {
  try {
    const questions = await db.many(
      `SELECT * FROM question
       WHERE type = 'cefr_placement' AND (brand_id = $1 OR brand_id IS NULL)
       ORDER BY RANDOM()
       LIMIT 20`,
      [req.brandId]
    );

    res.json({
      success: true,
      test: {
        subject: 'english',
        framework: 'CEFR',
        questions: questions.map(q => ({
          id: q.id,
          prompt: q.prompt,
          type: q.type,
          options: q.options
        }))
      }
    });
  } catch (err) {
    console.error('Get CEFR placement error:', err);
    res.status(500).json({
      success: false,
      error: 'GET_CEFR_TEST_FAILED',
      message: err.message
    });
  }
});

// Submit English CEFR placement
router.post('/english-cefr/submit', async (req, res) => {
  try {
    const { answers } = req.body;
    
    let correctCount = 0;
    
    for (const answer of answers) {
      const question = await db.one(
        'SELECT * FROM question WHERE id = $1',
        [answer.questionId]
      );

      if (question?.correct_answer?.toLowerCase().trim() ===
          answer.answer?.toLowerCase().trim()) {
        correctCount++;
      }
    }

    const score = Math.round((correctCount / answers.length) * 100);

    // Map score to CEFR level
    let cefrLevel = 'A1';
    if (score >= 95) cefrLevel = 'C2';
    else if (score >= 85) cefrLevel = 'C1';
    else if (score >= 75) cefrLevel = 'B2';
    else if (score >= 60) cefrLevel = 'B1';
    else if (score >= 40) cefrLevel = 'A2';

    // Save CEFR placement result
    await db.query(
      `INSERT INTO student_assessment (id, user_id, brand_id, subject, score, level, details)
       VALUES ($1, $2, $3, 'english_cefr', $4, $5, $6)
       ON CONFLICT (user_id, subject)
       DO UPDATE SET score = $4, level = $5, details = $6, assessed_at = NOW()`,
      [uuidv4(), req.user.id, req.brandId, score, cefrLevel,
       JSON.stringify({ total: answers.length, correct: correctCount, cefrLevel })]
    );

    res.json({
      success: true,
      score,
      cefrLevel,
      description: getCEFRDescription(cefrLevel)
    });
  } catch (err) {
    console.error('Submit CEFR placement error:', err);
    res.status(500).json({
      success: false,
      error: 'SUBMIT_CEFR_FAILED',
      message: err.message
    });
  }
});

function getCEFRDescription(level) {
  const descriptions = {
    'A1': 'Beginner - Can understand and use familiar everyday expressions',
    'A2': 'Elementary - Can communicate in simple and routine tasks',
    'B1': 'Intermediate - Can deal with most situations likely to arise while travelling',
    'B2': 'Upper Intermediate - Can interact with a degree of fluency and spontaneity',
    'C1': 'Advanced - Can express ideas fluently and spontaneously without much obvious searching',
    'C2': 'Proficiency - Can express themselves spontaneously, very fluently and precisely'
  };
  return descriptions[level] || '';
}

export default router;
