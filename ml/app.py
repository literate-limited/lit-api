"""
ML Service for lit-mvp
Runs alongside Express, handles ML workloads (pose detection, sign recognition)
"""

from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import os
import sys
import logging

# Add signphony to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'signphony'))

# Import signphony modules
from signphony.database import init_db
from signphony.unified_api import unified_api

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[ML] %(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Initialize Flask
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')

# CORS - allow Express to call us
CORS(app, resources={
    r"/*": {
        "origins": [
            "http://localhost:3000",  # Express API
            "http://localhost:5173",  # Vite dev (for direct testing)
        ]
    }
})

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*")

# Initialize database
try:
    init_db()
    logger.info("✓ Database initialized")
except Exception as e:
    logger.error(f"✗ Database initialization failed: {e}")

# Register signphony API blueprint
app.register_blueprint(unified_api, url_prefix='/signphony')

# Health check
@app.route('/health', methods=['GET'])
def health():
    """Health check for monitoring"""
    return jsonify({
        'status': 'healthy',
        'service': 'ml-service',
        'version': '1.0.0'
    })

# Status endpoint
@app.route('/status', methods=['GET'])
def status():
    """Detailed status"""
    return jsonify({
        'status': 'operational',
        'service': 'ml-service',
        'endpoints': {
            'signphony': '/signphony',
            'health': '/health'
        }
    })

# Import WebSocket handlers from signphony
try:
    from signphony.api import register_socketio_handlers
    register_socketio_handlers(socketio)
    logger.info("✓ WebSocket handlers registered")
except Exception as e:
    logger.warning(f"✗ WebSocket handlers not available: {e}")

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {error}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    port = int(os.environ.get('ML_PORT', 8000))

    logger.info("=" * 60)
    logger.info("Starting ML Service")
    logger.info("=" * 60)
    logger.info(f"Port: {port}")
    logger.info(f"Endpoints:")
    logger.info(f"  Health:    http://localhost:{port}/health")
    logger.info(f"  Status:    http://localhost:{port}/status")
    logger.info(f"  Signphony: http://localhost:{port}/signphony/*")
    logger.info("=" * 60)

    socketio.run(
        app,
        host='0.0.0.0',
        port=port,
        debug=os.environ.get('FLASK_ENV') != 'production',
        allow_unsafe_werkzeug=True
    )
