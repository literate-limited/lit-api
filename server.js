import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import db from './db.js';
import authRoutes from './routes/auth.js';
import classesRoutes from './routes/classes.js';
import roomsRoutes from './routes/rooms.js';
import curriculumRoutes from './routes/curriculum.js';
import messagesRoutes from './routes/messages.js';
import ssoRoutes from './routes/sso.js';
import ttvRoutes from './routes/ttv/teleprompt.js';
import lawloreRoutes from './routes/lawlore.js';
import placementRoutes from './routes/placement.js';
import progressRoutes from './routes/progress.js';
import pathwayRoutes from './routes/pathway.js';
import { processStudentMessage, checkUnitAssignmentTrigger } from './services/message.service.js';
import { getAllAllowedOrigins, isAllowedOrigin } from './config/brands.config.js';
import { brandResolver } from './middleware/brandResolver.js';

const app = express();
const httpServer = createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// Collect all brand origins for CORS
const brandOrigins = getAllAllowedOrigins();
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allOrigins = [...new Set([...brandOrigins, ...envOrigins])];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // Check if origin is allowed (exact match or regex)
    if (allOrigins.includes(origin) || isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-brand']
};

const io = new Server(httpServer, { cors: corsOptions });

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
// Needed for OAuth token exchange (`application/x-www-form-urlencoded`).
app.use(express.urlencoded({ extended: false }));

// Health check (outside /api for nginx monitoring)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// ---------------------------------------------------------------------------
// UI runtime config (served at the root, not under /api)
// ---------------------------------------------------------------------------
// The frontend expects these endpoints to exist even if no per-page styles are configured.
app.get('/ui/page-styles', (req, res) => {
  res.json({ styles: [] });
});

// Admin-only in the long run; for now return a clear "not implemented" so clients don't get 404s.
app.put('/ui/page-styles/:pageId', (req, res) => {
  res.status(501).json({ error: 'not_implemented' });
});

// Mount all routes under /api prefix (for Nginx reverse proxy)
app.use('/api/sso', ssoRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/curriculum', curriculumRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/ttv', ttvRoutes);
app.use('/api/law', lawloreRoutes);
app.use('/api/placement', placementRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/pathways', pathwayRoutes);

// Socket.io handlers with JWT authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.data.userId = decoded.userId;
    socket.data.brandId = decoded.brandId;
    socket.data.role = decoded.role;
    next();
  } catch (error) {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, 'User:', socket.data.userId);

  // Join room (with brand verification)
  socket.on('join_room', async ({ roomId, userName }) => {
    try {
      // Verify room belongs to user's brand
      const room = await db.one(
        'SELECT brand_id FROM chat_rooms WHERE id = $1',
        [roomId]
      );

      if (!room || room.brand_id !== socket.data.brandId) {
        socket.emit('error', { message: 'Room not found or access denied' });
        return;
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.userName = userName;

      console.log(`${userName} joined room ${roomId}`);

      // Notify others
      socket.to(roomId).emit('user_joined', {
        userId: socket.data.userId,
        userName,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Send student message (with AI processing)
  socket.on('send_message', async ({ roomId, content, targetLanguage = 'fr' }) => {
    try {
      const userId = socket.data.userId;
      const userName = socket.data.userName;

      if (!userId || !roomId || !content) {
        socket.emit('error', { message: 'Missing required fields: userId, roomId, content' });
        return;
      }

      // Check if user is a student
      const user = await db.one('SELECT role FROM users WHERE id = $1', [userId]);
      if (user?.role !== 'student') {
        socket.emit('error', { message: 'Only students can send messages for AI processing' });
        return;
      }

      console.log(`Processing message from ${userName} in room ${roomId}: "${content}"`);

      // Process message through full pipeline
      // This will:
      // 1. Store raw message
      // 2. Analyze with Claude (language tagging, errors)
      // 3. Store segments (word-level language annotations)
      // 4. Store analysis (metrics, gaps, topics)
      // 5. Update student assessment
      // 6. Generate AI response
      const result = await processStudentMessage(roomId, userId, content, targetLanguage);

      // Get student message with segments for display
      const studentMessage = await db.one(
        `
          SELECT
            m.id,
            m.raw_text,
            m.sender_role,
            m.created_at,
            u.first_name as "firstName",
            u.last_name as "lastName"
          FROM message m
          JOIN users u ON u.id = m.sender_id
          WHERE m.id = $1
        `,
        [result.messageId]
      );

      // Get segments for flip-able rendering
      const segments = await db.many(
        `
          SELECT
            segment_text as text,
            language_code as language,
            is_error,
            error_type,
            correction,
            char_start,
            char_end
          FROM message_segment
          WHERE message_id = $1
          ORDER BY segment_index ASC
        `,
        [result.messageId]
      );

      // Get analysis metrics
      const analysis = await db.one(
        `
          SELECT
            error_count,
            error_rate,
            identified_gaps,
            language_distribution
          FROM message_analysis
          WHERE message_id = $1
        `,
        [result.messageId]
      );

      // Broadcast student message with segments
      io.to(roomId).emit('student_message', {
        id: studentMessage.id,
        sender_id: userId,
        sender_role: 'student',
        sender_name: `${studentMessage.firstName} ${studentMessage.lastName}`,
        raw_text: studentMessage.raw_text,
        created_at: studentMessage.created_at,
        segments: segments,
        analysis: analysis ? {
          error_count: analysis.error_count,
          error_rate: analysis.error_rate,
          identified_gaps: analysis.identified_gaps || [],
          language_distribution: analysis.language_distribution || {}
        } : null
      });

      // Get AI user (create if needed)
      let aiUser = await db.one('SELECT id FROM users WHERE email = $1', ['ai@litlang.com']);
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

      // Broadcast AI response
      io.to(roomId).emit('ai_message', {
        id: result.aiResponse.messageId,
        sender_id: aiUser.id,
        sender_role: 'ai',
        sender_name: 'AI Assistant',
        raw_text: result.aiResponse.text,
        created_at: new Date().toISOString(),
        segments: [],
        pedagogical_intent: result.analysis.error_count > 0 ? 'correct_implicitly' : 'extend_vocabulary'
      });

      // Check if unit should be triggered
      if (result.shouldTriggerUnit) {
        const nextUnit = await checkUnitAssignmentTrigger(userId, targetLanguage);
        if (nextUnit) {
          io.to(roomId).emit('unit_assignment', {
            student_id: userId,
            unit_id: nextUnit.id,
            unit_name: nextUnit.name,
            reason: 'Competency gap identified in chat'
          });
        }
      }

      // Emit processing complete
      socket.emit('message_processed', {
        student_message_id: result.messageId,
        ai_response_id: result.aiResponse.messageId,
        unit_triggered: result.shouldTriggerUnit
      });

    } catch (error) {
      console.error('Error processing message:', error);
      socket.emit('error', {
        message: 'Failed to process message',
        details: error.message
      });
    }
  });

  // Typing indicator
  socket.on('typing', ({ roomId, userName }) => {
    socket.to(roomId).emit('user_typing', { userName });
  });

  socket.on('stop_typing', ({ roomId }) => {
    socket.to(roomId).emit('user_stopped_typing');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`
🚀 LIT MVP API Server running
📍 http://localhost:${PORT}
🔌 WebSocket ready
  `);
});
