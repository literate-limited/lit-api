# Unified Backend - Express + Python ML

## Architecture

The backend is now a **unified service** that runs:

1. **Express API** (Node.js) - Main API server (Port 3000)
2. **Python ML Service** (Flask) - ML workloads (Port 8000)

Both run in the same process/container and communicate internally.

```
┌────────────────────────────────────────┐
│   Unified Backend Service              │
│                                        │
│   Express (Port 3000)                  │
│   ├── /api/users                       │
│   ├── /api/auth                        │
│   ├── /api/curriculum                  │
│   └── /api/ml/* ──────┐                │
│                       │                │
│                       ▼                │
│   Python ML (Port 8000)                │
│   └── /signphony/*                     │
│       ├── /signs                       │
│       ├── /magic-tricks                │
│       └── /translate                   │
└────────────────────────────────────────┘
```

## Directory Structure

```
api/
├── server.js              # Express main server
├── routes/
│   ├── auth.js
│   ├── users.js
│   ├── ml.js             # NEW: ML proxy routes
│   └── ...
├── services/
│   ├── ml-service.js     # NEW: Python subprocess manager
│   └── ...
├── ml/                    # NEW: Python ML service
│   ├── app.py            # Flask entry point
│   ├── requirements.txt  # Python dependencies
│   └── signphony/        # Signphony backend
│       ├── database.py
│       ├── magic_tricks.py
│       ├── unified_api.py
│       ├── shared/
│       └── translator/
└── package.json
```

## How It Works

### 1. Server Startup

```javascript
// server.js starts Express
const app = express();

// Express spawns Python ML service
await mlService.start();
// → Spawns: python3 ml/app.py

// Express registers ML proxy routes
app.use('/api/ml', mlRoutes);
```

### 2. Request Flow

```
Frontend → Express → Python → Response

Example:
GET /api/ml/signphony/signs
  → Express receives request
  → Proxies to http://localhost:8000/signphony/signs
  → Python Flask handles it
  → Express returns response to frontend
```

### 3. Process Management

- Express spawns Python as a **child process**
- If Python crashes, Express can restart it
- Graceful shutdown stops both Express and Python
- Health checks monitor both services

## Development

### Install Dependencies

```bash
cd /Volumes/ll-ssd/projects/lit/lit-mvp/api

# Node dependencies
npm install

# Python dependencies
cd ml
pip3 install -r requirements.txt
cd ..
```

### Run Unified Backend

```bash
# Start both Express + Python
npm run dev

# You'll see:
# ✓ Server running on port 3000
# [ML Service] Starting Python ML service...
# [ML Service] Port: 8000
# ✓ ML service started successfully
```

### Test Endpoints

```bash
# Express health
curl http://localhost:3000/health

# ML health (through Express proxy)
curl http://localhost:3000/api/ml/health

# Signphony signs
curl http://localhost:3000/api/ml/signphony/signs

# Direct ML (for debugging)
curl http://localhost:8000/health
```

## Frontend Integration

### Old Way (Separate Deployments)

```javascript
// Frontend called two different APIs
const mainApi = 'http://localhost:3000';
const signphonyApi = 'http://localhost:8000';

await fetch(`${mainApi}/users`);
await fetch(`${signphonyApi}/signphony/signs`);
```

### New Way (Unified Backend)

```javascript
// Frontend calls ONE API for everything
const api = 'http://localhost:3000';

await fetch(`${api}/api/users`);
await fetch(`${api}/api/ml/signphony/signs`);
```

Update frontend `.env`:

```env
VITE_API_URL=http://localhost:3000
```

## Deployment

### Railway

Deploy as a single service:

```bash
cd /Volumes/ll-ssd/projects/lit/lit-mvp
railway up

# Railway will:
# 1. Build Docker image with Node + Python
# 2. Start Express server
# 3. Express spawns Python ML service
# 4. Both run in same container
```

### Dockerfile

```dockerfile
FROM node:20-slim

# Install Python
RUN apt-get install -y python3 python3-pip

# Install Node deps
COPY package*.json ./
RUN npm ci

# Install Python deps
COPY ml/requirements.txt ./ml/
RUN pip3 install -r ml/requirements.txt

# Copy code
COPY . .

# Start Express (which spawns Python)
CMD ["node", "server.js"]
```

## Environment Variables

```bash
# Node.js
PORT=3000
NODE_ENV=production
JWT_SECRET=your-secret

# Python ML
ML_PORT=8000
ML_HOST=localhost
PYTHON_CMD=python3

# Database (shared by both)
DATABASE_URL=postgres://...
```

## Benefits

✅ **Single Deployment** - One Railway service instead of two
✅ **Shared Database** - No data sync issues
✅ **Unified Auth** - Express handles auth for all endpoints
✅ **Cost Efficient** - One server, not two
✅ **Easier Development** - Start with one command
✅ **Better Monitoring** - All logs in one place

## Monitoring

### Health Checks

```bash
# Overall health
curl http://localhost:3000/health

# ML service health
curl http://localhost:3000/api/ml/health
```

### Logs

All logs are unified:

```
[Express] Server running on port 3000
[ML Service] Starting Python ML service...
[ML Service] Port: 8000
[ML Service] ✓ Database initialized
[Express] ✓ ML service started successfully
```

## Troubleshooting

### Python Service Won't Start

```bash
# Check Python is installed
python3 --version

# Check dependencies
cd ml
pip3 install -r requirements.txt

# Run Python directly (debug)
python3 app.py
```

### Proxy Errors

```bash
# Check ML service is running
curl http://localhost:8000/health

# Check proxy routes
curl http://localhost:3000/api/ml/health
```

### Port Conflicts

```bash
# If ports are in use, change them
export PORT=3001
export ML_PORT=8001
npm run dev
```

## Production Checklist

- [ ] Install both Node and Python dependencies
- [ ] Set environment variables
- [ ] Configure DATABASE_URL for both services
- [ ] Enable health check monitoring
- [ ] Set up log aggregation
- [ ] Configure restart policies
- [ ] Test ML service failover

## File Changes Summary

### New Files Created

- `ml/app.py` - Python ML service entry point
- `ml/requirements.txt` - Python dependencies
- `ml/signphony/` - Signphony backend code (moved)
- `services/ml-service.js` - Python subprocess manager
- `routes/ml.js` - ML proxy routes

### Files to Update

- `server.js` - Add ML service startup and routes (see SERVER_UPDATES.md)
- `package.json` - No changes needed (already has dependencies)

### Migration

1. ✅ Python code moved to `api/ml/signphony/`
2. ✅ ML service entry point created (`ml/app.py`)
3. ✅ Subprocess manager created (`services/ml-service.js`)
4. ✅ Proxy routes created (`routes/ml.js`)
5. ⏳ Update `server.js` (see SERVER_UPDATES.md)
6. ⏳ Test integration
7. ⏳ Deploy to Railway

## Next Steps

1. Apply updates from `SERVER_UPDATES.md` to `server.js`
2. Install Python dependencies: `cd ml && pip3 install -r requirements.txt`
3. Test locally: `npm run dev`
4. Update frontend to use unified API
5. Deploy to Railway

You now have a **unified backend** that's easier to develop, deploy, and maintain! 🎉
