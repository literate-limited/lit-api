"""
ML-based sign recognition inference for auslan_game.

Provides trained LSTM model inference as an alternative to DTW comparison.
Falls back to DTW if model unavailable or PyTorch not installed.
"""

import os
import sys
import json
import logging
import numpy as np
from pathlib import Path
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# Try to import PyTorch
try:
    import torch
    import torch.nn as nn
    PYTORCH_AVAILABLE = True
except ImportError:
    PYTORCH_AVAILABLE = False
    logger.warning("PyTorch not available - ML inference disabled")

# Handle both relative and absolute imports
try:
    from .config import ML_CONFIG, PATHS
except ImportError:
    from config import ML_CONFIG, PATHS


class SignRecognitionModel(nn.Module):
    """LSTM model for sign recognition (must match training architecture)."""

    def __init__(self, input_dim: int = 99, hidden_dim: int = 256, num_classes: int = 65):
        super().__init__()

        self.lstm1 = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=2,
            batch_first=True,
            dropout=0.3,
            bidirectional=True
        )

        self.lstm2 = nn.LSTM(
            input_size=hidden_dim * 2,
            hidden_size=hidden_dim,
            num_layers=1,
            batch_first=True,
            dropout=0.2
        )

        self.fc1 = nn.Linear(hidden_dim, 128)
        self.fc2 = nn.Linear(128, num_classes)
        self.dropout = nn.Dropout(0.3)
        self.relu = nn.ReLU()

    def forward(self, x):
        # LSTM layers
        lstm_out, _ = self.lstm1(x)
        lstm_out, _ = self.lstm2(lstm_out)

        # Use last hidden state
        last_hidden = lstm_out[:, -1, :]

        # FC layers
        fc1_out = self.relu(self.fc1(last_hidden))
        fc1_out = self.dropout(fc1_out)
        output = self.fc2(fc1_out)

        return output


class SignRecognitionInference:
    """
    ML-based sign recognition with fallback to DTW.

    Usage:
        inference = SignRecognitionInference()
        result = inference.predict(user_poses, reference_sign_name)
        print(f"Confidence: {result['confidence']:.1f}%")
    """

    def __init__(self, model_path: Optional[str] = None, config_path: Optional[str] = None):
        """
        Initialize inference engine.

        Args:
            model_path: Path to trained model (.pt file), None = use default
            config_path: Path to model config (.json), None = use default
        """
        self.model = None
        self.class_names = {}
        self.idx_to_class = {}
        self.num_classes = 0
        self.device = None
        self.model_available = False

        if not PYTORCH_AVAILABLE:
            logger.warning("PyTorch not available - ML inference disabled")
            return

        # Default paths
        if model_path is None:
            model_path = Path(PATHS['sign_models']) / 'recognition' / 'best_model.pt'
        if config_path is None:
            config_path = Path(PATHS['sign_models']) / 'recognition' / 'model.json'

        # Load model
        try:
            self._load_model(model_path, config_path)
            self.model_available = True
            logger.info(f"ML model loaded: {self.num_classes} classes, device: {self.device}")
        except Exception as e:
            logger.warning(f"Failed to load ML model: {e}")
            logger.info("Will fall back to DTW comparison")

    def _load_model(self, model_path: Path, config_path: Path):
        """Load trained model and configuration."""
        # Set device first
        if torch.backends.mps.is_available():
            self.device = torch.device('mps')  # Apple Silicon
        elif torch.cuda.is_available():
            self.device = torch.device('cuda')
        else:
            self.device = torch.device('cpu')

        # Load checkpoint to determine actual number of classes
        checkpoint = torch.load(model_path, map_location=self.device)

        # Detect num_classes from checkpoint weights
        if 'fc2.weight' in checkpoint:
            actual_num_classes = checkpoint['fc2.weight'].shape[0]
        else:
            # Fallback to config
            with open(config_path, 'r') as f:
                config = json.load(f)
            actual_num_classes = config['classes']

        logger.info(f"Detected {actual_num_classes} classes from model checkpoint")

        # Load config for class names (if available)
        if config_path.exists():
            try:
                with open(config_path, 'r') as f:
                    config = json.load(f)
                self.class_names = config.get('class_names', {})
                self.idx_to_class = {int(k): v for k, v in self.class_names.items()}
            except Exception as e:
                logger.warning(f"Could not load class names from config: {e}")
                self.class_names = {}
                self.idx_to_class = {}

        self.num_classes = actual_num_classes

        # Create model with correct number of classes
        self.model = SignRecognitionModel(num_classes=self.num_classes)

        # Load weights
        self.model.load_state_dict(checkpoint)
        self.model.to(self.device)
        self.model.eval()

    def _preprocess_poses(self, poses: np.ndarray, max_frames: int = 150) -> torch.Tensor:
        """
        Preprocess pose sequence for model input.

        Args:
            poses: np.array of shape (n_frames, 33, 3)
            max_frames: Pad/truncate to this length

        Returns:
            Tensor of shape (1, max_frames, 99) ready for model
        """
        # Flatten spatial dimensions: (n_frames, 33, 3) → (n_frames, 99)
        features = poses.reshape(poses.shape[0], -1)

        # Pad or truncate to max_frames
        if len(features) < max_frames:
            pad = np.zeros((max_frames - len(features), features.shape[1]))
            features = np.vstack([features, pad])
        else:
            features = features[:max_frames]

        # Convert to tensor and add batch dimension
        tensor = torch.FloatTensor(features).unsqueeze(0)  # (1, 150, 99)
        return tensor.to(self.device)

    def predict(self, user_poses: np.ndarray, reference_sign: str = None) -> Dict:
        """
        Predict sign from pose sequence.

        Args:
            user_poses: np.array of shape (n_frames, 33, 3)
            reference_sign: Expected sign name (for scoring), optional

        Returns:
            Dictionary with:
                - predicted_sign: str
                - confidence: float (0-100)
                - top_k_predictions: list of (sign, confidence) tuples
                - method: 'ml' or 'dtw' (fallback)
                - match: bool (if reference_sign provided)
        """
        result = {
            'predicted_sign': None,
            'confidence': 0.0,
            'top_k_predictions': [],
            'method': 'ml',
            'match': None,
            'scores': {}
        }

        # Check if model available
        if not self.model_available or self.model is None:
            result['method'] = 'dtw'
            result['confidence'] = 0.0
            result['predicted_sign'] = 'model_unavailable'
            return result

        try:
            # Preprocess
            input_tensor = self._preprocess_poses(user_poses)

            # Inference
            with torch.no_grad():
                logits = self.model(input_tensor)
                probabilities = torch.softmax(logits, dim=1)

            # Get predictions
            probs_np = probabilities.cpu().numpy()[0]
            top_k_indices = np.argsort(probs_np)[::-1][:5]  # Top 5

            # Format results
            result['top_k_predictions'] = []
            for idx in top_k_indices:
                idx_int = int(idx)  # Convert numpy int to Python int
                class_name = self.idx_to_class.get(idx_int, f"class_{idx_int}")
                confidence = float(probs_np[idx_int] * 100)
                result['top_k_predictions'].append((class_name, confidence))

            if result['top_k_predictions']:
                result['predicted_sign'] = result['top_k_predictions'][0][0]
                result['confidence'] = result['top_k_predictions'][0][1]

            # Check if prediction matches reference
            if reference_sign is not None:
                normalized_ref = reference_sign.lower().replace(' ', '_').replace('-', '_')
                result['match'] = (result['predicted_sign'] == normalized_ref)

            # Store all class scores (only if class names available)
            if self.idx_to_class:
                result['scores'] = {
                    self.idx_to_class.get(i, f"class_{i}"): float(probs_np[i] * 100)
                    for i in range(min(len(probs_np), len(self.idx_to_class)))
                }

        except Exception as e:
            logger.error(f"ML inference failed: {e}")
            result['method'] = 'error'
            result['confidence'] = 0.0

        return result

    def score_against_reference(self, user_poses: np.ndarray, reference_sign: str) -> float:
        """
        Score user's attempt against a reference sign (0-100 scale).

        This provides a drop-in replacement for DTW scoring.

        Args:
            user_poses: np.array of shape (n_frames, 33, 3)
            reference_sign: Expected sign name

        Returns:
            Score from 0-100 (higher is better)
        """
        result = self.predict(user_poses, reference_sign)

        if result['method'] == 'ml' and result['match']:
            # User performed the correct sign
            return result['confidence']
        elif result['method'] == 'ml':
            # User performed wrong sign - look up confidence for correct sign
            normalized_ref = reference_sign.lower().replace(' ', '_').replace('-', '_')
            if normalized_ref in result['scores']:
                return result['scores'][normalized_ref]
            else:
                return 0.0  # Sign not in training set
        else:
            # ML unavailable, return neutral score
            return 50.0

    def is_available(self) -> bool:
        """Check if ML inference is available."""
        return self.model_available

    def get_model_info(self) -> Dict:
        """Get information about loaded model."""
        return {
            'available': self.model_available,
            'num_classes': self.num_classes,
            'device': str(self.device) if self.device else None,
            'class_names': list(self.class_names.values()) if self.class_names else []
        }


# Convenience function for game integration
def create_inference_engine() -> SignRecognitionInference:
    """
    Create inference engine with default settings.

    Returns:
        SignRecognitionInference instance
    """
    return SignRecognitionInference()


# Test code
if __name__ == '__main__':
    print("=" * 70)
    print("TESTING ML INFERENCE ENGINE")
    print("=" * 70)

    # Create inference engine
    inference = create_inference_engine()

    if inference.is_available():
        print(f"\n✓ ML model loaded successfully")
        info = inference.get_model_info()
        print(f"  Classes: {info['num_classes']}")
        print(f"  Device: {info['device']}")
        print(f"  Sample classes: {info['class_names'][:10]}")

        # Create dummy pose data for testing
        print(f"\n[Test] Creating synthetic pose data...")
        test_poses = np.random.rand(60, 33, 3)  # 60 frames
        test_poses[:, :, 2] = 0.9  # High visibility

        # Test prediction
        print(f"\n[Test] Running inference...")
        result = inference.predict(test_poses)

        print(f"\n  Predicted: {result['predicted_sign']}")
        print(f"  Confidence: {result['confidence']:.1f}%")
        print(f"  Method: {result['method']}")
        print(f"\n  Top 5 predictions:")
        for sign, conf in result['top_k_predictions']:
            print(f"    {sign}: {conf:.1f}%")

        # Test scoring
        print(f"\n[Test] Testing scoring against reference...")
        score = inference.score_against_reference(test_poses, "hello")
        print(f"  Score for 'hello': {score:.1f}/100")

    else:
        print(f"\n✗ ML model not available")
        print(f"  Reason: {inference.get_model_info()}")

    print("\n" + "=" * 70)
