"""
Shared pose extraction module for sign language projects.

This module provides unified MediaPipe pose extraction for both auslan_game
and sign projects, ensuring consistency in data format and preprocessing.
"""

import os
import sys
import json
import logging
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import cv2

try:
    import mediapipe as mp
except ImportError:
    print("MediaPipe not installed. Install with: pip install mediapipe")
    mp = None

from .config import MEDIAPIPE_CONFIG, POSE_PROCESSING, STORAGE_CONFIG, LANDMARK_INDICES

logger = logging.getLogger(__name__)


class MediaPipeExtractor:
    """MediaPipe pose extraction with configurable normalization."""

    def __init__(self, normalize=True):
        """
        Initialize MediaPipe pose extractor.

        Args:
            normalize: Whether to apply normalization to extracted poses
        """
        self.normalize = normalize

        if mp is None:
            raise ImportError("MediaPipe not installed")

        # Initialize MediaPipe Pose
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            model_complexity=MEDIAPIPE_CONFIG['model_complexity'],
            smooth_landmarks=MEDIAPIPE_CONFIG['smooth_landmarks'],
            min_detection_confidence=MEDIAPIPE_CONFIG['min_detection_confidence'],
            min_tracking_confidence=MEDIAPIPE_CONFIG['min_tracking_confidence']
        )

    def extract_from_video(self, video_path: str, max_frames: Optional[int] = None) -> Optional[Dict]:
        """
        Extract pose landmarks from a video file.

        Args:
            video_path: Path to video file
            max_frames: Maximum number of frames to process (None = all)

        Returns:
            Dictionary containing:
                - landmarks: np.array of shape (n_frames, 33, 3)
                - visibility: np.array of shape (n_frames, 33)
                - metadata: dict with video info
            Returns None if extraction fails
        """
        if not os.path.exists(video_path):
            logger.error(f"Video not found: {video_path}")
            return None

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"Failed to open video: {video_path}")
            return None

        try:
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            logger.info(f"Processing: {Path(video_path).name}")
            logger.info(f"  Video: {frame_count} frames, {fps:.1f}fps, {width}x{height}")

            landmarks_list = []
            visibility_list = []
            frame_idx = 0

            # Apply max_frames limit
            if max_frames is None:
                max_frames = POSE_PROCESSING['max_frames']

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                # Stop if we've reached max frames
                if max_frames and frame_idx >= max_frames:
                    break

                # Convert BGR to RGB
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

                # Get pose
                results = self.pose.process(rgb_frame)

                if results.pose_landmarks:
                    # Extract landmarks (x, y, z)
                    landmarks = np.array([
                        [lm.x, lm.y, lm.z] for lm in results.pose_landmarks.landmark
                    ])
                    visibility = np.array([
                        lm.visibility for lm in results.pose_landmarks.landmark
                    ])

                    landmarks_list.append(landmarks)
                    visibility_list.append(visibility)
                else:
                    # Use zeros if no pose detected
                    landmarks_list.append(np.zeros((33, 3)))
                    visibility_list.append(np.zeros(33))

                frame_idx += 1
                if frame_idx % 30 == 0:
                    logger.debug(f"  Processed {frame_idx}/{frame_count} frames")

            cap.release()

            if not landmarks_list:
                logger.error(f"No frames extracted from {video_path}")
                return None

            # Convert to numpy arrays
            landmarks_array = np.array(landmarks_list)  # (frames, 33, 3)
            visibility_array = np.array(visibility_list)  # (frames, 33)

            logger.info(f"  ✓ Extracted {len(landmarks_list)} frames")

            result = {
                'landmarks': landmarks_array,
                'visibility': visibility_array,
                'metadata': {
                    'video_path': str(video_path),
                    'frames': len(landmarks_list),
                    'fps': fps,
                    'resolution': (width, height),
                    'extracted_at': datetime.now().isoformat()
                }
            }

            # Apply normalization if requested
            if self.normalize:
                result = self.normalize_poses(result)

            return result

        except Exception as e:
            logger.error(f"Extraction failed: {e}")
            return None

        finally:
            cap.release()

    def normalize_poses(self, data: Dict) -> Dict:
        """
        Normalize pose data (scale and translation invariant).

        Centers poses at origin and scales to unit variance.

        Args:
            data: Dictionary with 'landmarks' and 'visibility' arrays

        Returns:
            Same dict with added 'landmarks_normalized' key
        """
        landmarks = data['landmarks']  # (frames, 33, 3)
        visibility = data['visibility']  # (frames, 33)

        normalized = np.zeros_like(landmarks)
        vis_threshold = MEDIAPIPE_CONFIG['visibility_threshold']

        for frame_idx in range(landmarks.shape[0]):
            frame = landmarks[frame_idx]

            # Filter out low-confidence landmarks
            valid = visibility[frame_idx] >= vis_threshold

            if np.sum(valid) < 5:
                # Not enough valid landmarks, keep original
                normalized[frame_idx] = frame
                continue

            # Center on torso (average of valid landmarks)
            center = np.mean(frame[valid], axis=0)
            centered = frame - center

            # Scale to unit variance
            valid_pts = centered[valid]
            scale = np.std(valid_pts) + 1e-8
            normalized[frame_idx] = centered / scale

        data['landmarks_normalized'] = normalized
        return data

    def save_to_npz(self, data: Dict, output_path: str) -> bool:
        """
        Save extracted poses to NPZ file.

        Args:
            data: Dictionary from extract_from_video()
            output_path: Output .npz file path

        Returns:
            True if successful, False otherwise
        """
        try:
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            save_dict = {}

            if STORAGE_CONFIG['save_raw_landmarks']:
                save_dict['landmarks'] = data['landmarks']

            if STORAGE_CONFIG['save_normalized_landmarks'] and 'landmarks_normalized' in data:
                save_dict['landmarks_normalized'] = data['landmarks_normalized']

            if STORAGE_CONFIG['save_visibility']:
                save_dict['visibility'] = data['visibility']

            if STORAGE_CONFIG['save_metadata']:
                save_dict['metadata'] = json.dumps(data['metadata'])

            np.savez_compressed(output_path, **save_dict)

            file_size_mb = output_path.stat().st_size / (1024 * 1024)
            logger.info(f"  ✓ Saved to {output_path.name} ({file_size_mb:.2f} MB)")

            return True

        except Exception as e:
            logger.error(f"Failed to save NPZ: {e}")
            return False

    def save_to_blob(self, data: Dict) -> bytes:
        """
        Convert poses to binary blob for SQLite storage.

        Args:
            data: Dictionary from extract_from_video()

        Returns:
            Binary blob (bytes)
        """
        # Use normalized landmarks if available, otherwise raw
        if 'landmarks_normalized' in data:
            poses = data['landmarks_normalized']
        else:
            poses = data['landmarks']

        return poses.tobytes()

    def load_from_npz(self, npz_path: str) -> Optional[Dict]:
        """
        Load pose data from NPZ file.

        Args:
            npz_path: Path to .npz file

        Returns:
            Dictionary with landmarks, visibility, metadata
        """
        try:
            data = np.load(npz_path, allow_pickle=True)

            result = {
                'landmarks': data['landmarks'] if 'landmarks' in data else None,
                'landmarks_normalized': data['landmarks_normalized'] if 'landmarks_normalized' in data else None,
                'visibility': data['visibility'] if 'visibility' in data else None,
                'metadata': json.loads(str(data['metadata'])) if 'metadata' in data else {}
            }

            return result

        except Exception as e:
            logger.error(f"Failed to load NPZ: {e}")
            return None

    def load_from_blob(self, blob: bytes, shape: Tuple[int, int, int]) -> np.ndarray:
        """
        Load pose data from binary blob.

        Args:
            blob: Binary data from SQLite
            shape: Expected shape (n_frames, 33, 3)

        Returns:
            Numpy array of poses
        """
        poses = np.frombuffer(blob, dtype=np.float64)
        return poses.reshape(shape)

    def __del__(self):
        """Clean up MediaPipe resources."""
        if hasattr(self, 'pose'):
            self.pose.close()


def focus_on_body_part(poses: np.ndarray, part: str = 'hands') -> np.ndarray:
    """
    Filter pose data to focus on specific body part.

    Args:
        poses: np.array of shape (n_frames, 33, 3)
        part: Body part name from LANDMARK_INDICES

    Returns:
        Filtered poses with non-relevant landmarks zeroed out
    """
    if part not in LANDMARK_INDICES:
        raise ValueError(f"Unknown body part: {part}. Available: {list(LANDMARK_INDICES.keys())}")

    indices = LANDMARK_INDICES[part]
    focused = np.zeros_like(poses)

    # Copy only the relevant landmarks
    focused[:, indices, :] = poses[:, indices, :]

    return focused


def batch_extract_videos(video_paths: List[str], output_dir: str, normalize: bool = True) -> Dict:
    """
    Extract poses from multiple videos in batch.

    Args:
        video_paths: List of video file paths
        output_dir: Directory to save NPZ files
        normalize: Whether to normalize poses

    Returns:
        Dictionary with processing statistics
    """
    extractor = MediaPipeExtractor(normalize=normalize)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    stats = {
        'total': len(video_paths),
        'successful': 0,
        'failed': 0,
        'failed_files': []
    }

    for idx, video_path in enumerate(video_paths, 1):
        logger.info(f"[{idx}/{len(video_paths)}] Processing {Path(video_path).name}")

        data = extractor.extract_from_video(video_path)

        if data is not None:
            # Create output filename
            video_name = Path(video_path).stem
            output_path = output_dir / f"{video_name}.npz"

            if extractor.save_to_npz(data, str(output_path)):
                stats['successful'] += 1
            else:
                stats['failed'] += 1
                stats['failed_files'].append(video_path)
        else:
            stats['failed'] += 1
            stats['failed_files'].append(video_path)

    logger.info(f"\nBatch extraction complete:")
    logger.info(f"  Successful: {stats['successful']}/{stats['total']}")
    logger.info(f"  Failed: {stats['failed']}/{stats['total']}")

    return stats
