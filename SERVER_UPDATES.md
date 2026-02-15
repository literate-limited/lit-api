# Server.js Updates for ML Service Integration

## Changes Needed

Add these changes to `/api/server.js`:

### 1. Import ML Service (add near top with other imports)

```javascript
import mlRoutes from './routes/ml.js';
import mlService from './services/ml-service.js';
```

### 2. Register ML Routes (add with other route registrations)

```javascript
// ML Service routes (Signphony, pose detection, etc.)
app.use('/api/ml', mlRoutes);
```

### 3. Start ML Service on Server Startup (modify the server start section)

```javascript
// Current code (around line 400+):
httpServer.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});

// UPDATE TO:
httpServer.listen(PORT, async () => {
  console.log(`✓ Server running on port ${PORT}`);

  // Start ML service
  try {
    console.log('Starting ML service...');
    await mlService.start();
    console.log('✓ ML service started successfully');
  } catch (error) {
    console.warn('⚠ ML service failed to start:', error.message);
    console.warn('⚠ Continuing without ML capabilities');
  }
});
```

### 4. Graceful Shutdown (add at the bottom of server.js)

```javascript
// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  mlService.stop();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  mlService.stop();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
```

## Complete Integration Points

The changes integrate ML service into the existing Express server:

```
Express Server (Port 3000)
├── /api/auth              → existing routes
├── /api/users             → existing routes
├── /api/curriculum        → existing routes
├── /api/ml/*              → NEW: proxies to Python (Port 8000)
│   ├── /api/ml/health     → ML health check
│   └── /api/ml/signphony/* → Signphony endpoints
└── [other routes]
```

## ML Service Architecture

```
┌─────────────────────────────────────┐
│   Express Server (Node.js)          │
│   Port: 3000                        │
│                                     │
│   ┌─────────────────────────────┐  │
│   │  ML Service Manager         │  │
│   │  (subprocess controller)    │  │
│   └────────────┬────────────────┘  │
│                │ spawns             │
│                ▼                    │
│   ┌─────────────────────────────┐  │
│   │  Python ML Service          │  │
│   │  Port: 8000                 │  │
│   │  - Flask app                │  │
│   │  - Signphony endpoints      │  │
│   │  - Pose detection           │  │
│   │  - ML inference             │  │
│   └─────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Testing

After making these changes:

```bash
cd /Volumes/ll-ssd/projects/lit/lit-mvp/api

# Install Python dependencies
cd ml
pip install -r requirements.txt
cd ..

# Start the server
npm run dev

# You should see:
# ✓ Server running on port 3000
# [ML Service] Starting Python ML service...
# [ML Service] Port: 8000
# ✓ ML service started successfully
```

## Testing ML Endpoints

```bash
# Health check
curl http://localhost:3000/api/ml/health

# Signphony health
curl http://localhost:3000/api/ml/signphony/signs

# Direct ML service (for debugging)
curl http://localhost:8000/health
```

## Frontend Configuration

Update frontend `.env`:

```env
# OLD (separate deployment):
# VITE_SIGNPHONY_API_URL=http://localhost:8000

# NEW (unified backend):
VITE_API_URL=http://localhost:3000
```

Frontend now calls:
- `/api/users` → Express
- `/api/curriculum` → Express
- `/api/ml/signphony/*` → Express → Python ML service

All through one API!
