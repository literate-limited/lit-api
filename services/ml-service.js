/**
 * ML Service Manager
 * Spawns and manages Python ML service subprocess
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class MLServiceManager {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.port = process.env.ML_PORT || 8000;
    this.host = process.env.ML_HOST || 'localhost';
  }

  /**
   * Start the Python ML service
   */
  start() {
    return new Promise((resolve, reject) => {
      const mlPath = join(__dirname, '../ml');
      const pythonCmd = process.env.PYTHON_CMD || 'python3';

      console.log('[ML Service] Starting Python ML service...');
      console.log(`[ML Service] Path: ${mlPath}/app.py`);
      console.log(`[ML Service] Port: ${this.port}`);

      // Spawn Python process
      this.process = spawn(pythonCmd, ['app.py'], {
        cwd: mlPath,
        env: {
          ...process.env,
          ML_PORT: this.port,
          PYTHONUNBUFFERED: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Handle stdout
      this.process.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[ML Service] ${output.trim()}`);

        // Check if service is ready
        if (output.includes('Starting ML Service') || output.includes('Running on')) {
          this.isReady = true;
          if (!this._resolved) {
            this._resolved = true;
            resolve();
          }
        }
      });

      // Handle stderr
      this.process.stderr.on('data', (data) => {
        console.error(`[ML Service] ERROR: ${data.toString().trim()}`);
      });

      // Handle process exit
      this.process.on('exit', (code) => {
        console.log(`[ML Service] Process exited with code ${code}`);
        this.isReady = false;
        this.process = null;
      });

      // Handle errors
      this.process.on('error', (error) => {
        console.error(`[ML Service] Failed to start: ${error.message}`);
        this.isReady = false;
        reject(error);
      });

      // Timeout if not ready in 30 seconds
      setTimeout(() => {
        if (!this.isReady && !this._resolved) {
          this._resolved = true;
          console.warn('[ML Service] Startup timeout - continuing anyway');
          resolve(); // Don't reject, allow API to start without ML
        }
      }, 30000);
    });
  }

  /**
   * Stop the Python ML service
   */
  stop() {
    if (this.process) {
      console.log('[ML Service] Stopping...');
      this.process.kill('SIGTERM');
      this.process = null;
      this.isReady = false;
    }
  }

  /**
   * Check if ML service is ready
   */
  ready() {
    return this.isReady;
  }

  /**
   * Get ML service URL
   */
  getUrl() {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Health check - ping ML service
   */
  async healthCheck() {
    if (!this.isReady) {
      return { healthy: false, reason: 'Service not ready' };
    }

    try {
      const response = await fetch(`${this.getUrl()}/health`);
      if (response.ok) {
        const data = await response.json();
        return { healthy: true, ...data };
      }
      return { healthy: false, reason: 'Health check failed' };
    } catch (error) {
      return { healthy: false, reason: error.message };
    }
  }
}

// Singleton instance
const mlService = new MLServiceManager();

export default mlService;
