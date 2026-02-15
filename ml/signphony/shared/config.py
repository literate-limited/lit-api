"""
Shared configuration for sign language processing projects.

This module contains centralized configuration used by both auslan_game
and sign projects to ensure consistency in pose extraction and comparison.
"""

import os
from pathlib import Path

# Environment Detection
# Auto-detect if running in production (Railway) vs local development
_is_production = os.getenv('RAILWAY_ENVIRONMENT') is not None or not os.path.exists('/Volumes/ll-ssd')
_base_dir = Path(__file__).parent.parent if _is_production else Path('/Volumes/ll-ssd')

# MediaPipe Pose Configuration
MEDIAPIPE_CONFIG = {
    # Number of pose landmarks (MediaPipe body model)
    'num_landmarks': 33,

    # Model complexity: 0=lite, 1=full, 2=heavy
    'model_complexity': 1,

    # Minimum detection confidence
    'min_detection_confidence': 0.5,

    # Minimum tracking confidence
    'min_tracking_confidence': 0.5,

    # Enable landmark smoothing
    'smooth_landmarks': True,

    # Visibility threshold for filtering low-confidence landmarks
    'visibility_threshold': 0.5,
}

# Pose Processing Configuration
POSE_PROCESSING = {
    # Maximum number of frames to extract per video
    'max_frames': 150,

    # Target frame rate for resampling (None = keep original)
    'target_fps': None,

    # Normalization method: 'torso_center' or 'none'
    'normalization': 'torso_center',

    # Scale method: 'unit_variance' or 'none'
    'scale_method': 'unit_variance',
}

# DTW (Dynamic Time Warping) Configuration
DTW_CONFIG = {
    # Visibility threshold for DTW comparison
    'visibility_threshold': 0.5,

    # Maximum DTW distance for scoring (empirically determined)
    'max_distance': 8.0,

    # Use hand-focused comparison (true) or full body (false)
    'use_hand_focus': True,

    # DTW window size (None = no constraint)
    'window_size': None,

    # Use fast approximate DTW (true) or exact (false)
    'use_fast_dtw': True,
}

# Landmark Indices by Body Part
LANDMARK_INDICES = {
    # Hand landmarks (used for hand-focused comparison)
    'hands': [9, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],

    # Upper body (shoulders, arms, torso)
    'upper_body': [0, 1, 2, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],

    # Torso (used for normalization center)
    'torso': [11, 12],  # Left hip, right hip

    # Face
    'face': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],

    # Legs
    'legs': [23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
}

# Data Storage Configuration
STORAGE_CONFIG = {
    # NPZ compression level (0-9, higher = more compression)
    'npz_compression': 6,

    # Include raw landmarks in NPZ files
    'save_raw_landmarks': True,

    # Include normalized landmarks in NPZ files
    'save_normalized_landmarks': True,

    # Include visibility array in NPZ files
    'save_visibility': True,

    # Include metadata in NPZ files
    'save_metadata': True,
}

# Machine Learning Configuration
ML_CONFIG = {
    # Input sequence length for models (frames)
    'sequence_length': 150,

    # Batch size for training
    'batch_size': 32,

    # Learning rate
    'learning_rate': 0.001,

    # Model checkpoint directory
    'checkpoint_dir': '/Volumes/ll-ssd/sign/models',

    # Device: 'cuda', 'mps', or 'cpu'
    'device': 'cpu' if _is_production else 'mps',  # CPU for production, MPS for local Apple Silicon
}

# Directory Paths
if _is_production:
    # Production paths (relative to app directory)
    PATHS = {
        'sign_project_root': str(_base_dir),
        'sign_raw_data': str(_base_dir / 'data' / 'raw'),
        'sign_processed_poses': str(_base_dir / 'data' / 'processed' / 'poses'),
        'sign_models': str(_base_dir / 'models'),

        'auslan_game_root': str(_base_dir),
        'auslan_game_db': str(_base_dir / 'auslan_game.db'),
        'auslan_game_videos': str(_base_dir / 'reference_videos'),
        'auslan_game_poses': str(_base_dir / 'reference_poses'),

        'shared_root': str(_base_dir / 'shared'),
    }
else:
    # Local development paths (absolute)
    PATHS = {
        'sign_project_root': '/Volumes/ll-ssd/sign',
        'sign_raw_data': '/Volumes/ll-ssd/sign/data/raw',
        'sign_processed_poses': '/Volumes/ll-ssd/sign/data/processed/poses',
        'sign_models': '/Volumes/ll-ssd/sign/models',

        'auslan_game_root': '/Volumes/ll-ssd/auslan_game',
        'auslan_game_db': '/Volumes/ll-ssd/auslan_game/auslan_game.db',
        'auslan_game_videos': '/Volumes/ll-ssd/auslan_game/reference_videos',
        'auslan_game_poses': '/Volumes/ll-ssd/auslan_game/reference_poses',

        'shared_root': '/Volumes/ll-ssd/shared',
    }

# Logging Configuration
LOGGING = {
    'level': 'INFO',  # DEBUG, INFO, WARNING, ERROR
    'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    'date_format': '%Y-%m-%d %H:%M:%S',
}
