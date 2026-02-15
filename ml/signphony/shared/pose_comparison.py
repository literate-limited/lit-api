"""
Shared pose comparison module using Dynamic Time Warping (DTW).

Provides functions for comparing pose sequences with configurable parameters.
"""

import numpy as np
from scipy.spatial.distance import euclidean
from scipy.signal import resample

from .config import DTW_CONFIG, LANDMARK_INDICES, MEDIAPIPE_CONFIG


def flatten_poses(poses):
    """
    Flatten pose data into 2D array suitable for comparison.

    Args:
        poses: np.array of shape (n_frames, num_landmarks, 3)

    Returns:
        flattened: np.array of shape (n_frames, num_landmarks*3)
    """
    n_frames = poses.shape[0]
    num_landmarks = poses.shape[1]
    return poses.reshape(n_frames, num_landmarks * 3)


def filter_poses_by_visibility(poses, visibility_threshold=None):
    """
    Filter out landmarks with low visibility/confidence.

    Args:
        poses: np.array of shape (n_frames, num_landmarks, 3)
        visibility_threshold: minimum confidence value (z-coordinate)
                            None = use config default

    Returns:
        filtered_poses: same shape, low-visibility landmarks set to nan
    """
    if visibility_threshold is None:
        visibility_threshold = DTW_CONFIG['visibility_threshold']

    filtered = poses.copy()
    # Z-coordinate (index 2) represents visibility/confidence
    mask = poses[:, :, 2] < visibility_threshold
    filtered[mask] = np.nan
    return filtered


def normalize_poses(poses):
    """
    Normalize poses by removing NaN values and scaling.

    Args:
        poses: np.array of shape (n_frames, num_landmarks*3)

    Returns:
        normalized: cleaned and scaled poses
    """
    # Remove NaN values by replacing with mean
    poses_clean = poses.copy()
    for i in range(poses_clean.shape[1]):
        col = poses_clean[:, i]
        # Replace NaN with column mean
        col_mean = np.nanmean(col)
        if not np.isnan(col_mean):
            poses_clean[np.isnan(col), i] = col_mean
        else:
            poses_clean[np.isnan(col), i] = 0

    # Normalize each dimension to [0, 1]
    for i in range(poses_clean.shape[1]):
        col_min = np.min(poses_clean[:, i])
        col_max = np.max(poses_clean[:, i])
        if col_max > col_min:
            poses_clean[:, i] = (poses_clean[:, i] - col_min) / (col_max - col_min)

    return poses_clean


def euclidean_distance(ref_poses, user_poses):
    """
    Calculate euclidean distance between pose sequences.
    Aligns sequences by resampling to same length.

    Args:
        ref_poses: np.array of shape (n_frames, num_landmarks*3)
        user_poses: np.array of shape (m_frames, num_landmarks*3)

    Returns:
        distance: scalar average euclidean distance
    """
    # Resample both to common length (use reference length)
    n_features = ref_poses.shape[1]
    target_length = ref_poses.shape[0]

    if user_poses.shape[0] != target_length:
        user_resampled = np.zeros((target_length, n_features))
        for i in range(n_features):
            user_resampled[:, i] = resample(user_poses[:, i], target_length)
    else:
        user_resampled = user_poses

    # Calculate frame-by-frame distance
    distances = []
    for i in range(target_length):
        d = euclidean(ref_poses[i], user_resampled[i])
        distances.append(d)

    return np.mean(distances)


def dtw_distance(ref_poses, user_poses, use_fast=None):
    """
    Calculate Dynamic Time Warping distance between pose sequences.

    Args:
        ref_poses: np.array of shape (n_frames, num_landmarks*3)
        user_poses: np.array of shape (m_frames, num_landmarks*3)
        use_fast: Use fast approximate DTW (None = use config)

    Returns:
        normalized_distance: scalar in range [0, ~10]
    """
    if use_fast is None:
        use_fast = DTW_CONFIG['use_fast_dtw']

    try:
        from dtaidistance import dtw
    except ImportError:
        # Fallback to simpler euclidean distance if dtaidistance not available
        return euclidean_distance(ref_poses, user_poses)

    # Handle edge cases
    if ref_poses.shape[0] == 0 or user_poses.shape[0] == 0:
        return DTW_CONFIG['max_distance']  # Max distance

    # Calculate DTW distance
    if use_fast:
        # Use fastdtw for speed
        try:
            from fastdtw import fastdtw
            distance, _ = fastdtw(ref_poses, user_poses, dist=euclidean)
        except ImportError:
            distance = dtw.distance(ref_poses, user_poses)
    else:
        distance = dtw.distance(ref_poses, user_poses)

    return distance


def compare_sign_sequences(reference_poses, user_poses, visibility_threshold=None,
                          method='dtw', use_hand_focus=None):
    """
    Compare two pose sequences and return a score.

    Args:
        reference_poses: np.array of shape (n_frames, num_landmarks, 3)
        user_poses: np.array of shape (m_frames, num_landmarks, 3)
        visibility_threshold: minimum confidence for a landmark (None = use config)
        method: 'dtw' (default) or 'euclidean'
        use_hand_focus: Focus on hand landmarks (None = use config)

    Returns:
        score: float in range [0, 100] where 100 is perfect match
    """
    # Use config defaults if not specified
    if visibility_threshold is None:
        visibility_threshold = DTW_CONFIG['visibility_threshold']
    if use_hand_focus is None:
        use_hand_focus = DTW_CONFIG['use_hand_focus']

    # Validate inputs
    if len(reference_poses) == 0 or len(user_poses) == 0:
        return 0.0

    # Focus on hands if requested
    if use_hand_focus:
        reference_poses = focus_on_body_part(reference_poses, 'hands')
        user_poses = focus_on_body_part(user_poses, 'hands')

    # Filter by visibility
    ref_filtered = filter_poses_by_visibility(reference_poses, visibility_threshold)
    user_filtered = filter_poses_by_visibility(user_poses, visibility_threshold)

    # Flatten poses
    ref_flat = flatten_poses(ref_filtered)
    user_flat = flatten_poses(user_filtered)

    # Normalize
    ref_normalized = normalize_poses(ref_flat)
    user_normalized = normalize_poses(user_flat)

    # Calculate distance
    if method == 'dtw':
        distance = dtw_distance(ref_normalized, user_normalized)
    else:
        distance = euclidean_distance(ref_normalized, user_normalized)

    # Convert to score (0-100)
    max_distance = DTW_CONFIG['max_distance']
    score = max(0, 100 * (1 - distance / max_distance))
    score = min(100, score)  # Cap at 100

    return score


def focus_on_body_part(poses, part='hands'):
    """
    Focus comparison on specific body part landmarks.

    Args:
        poses: np.array of shape (n_frames, 33, 3)
        part: Body part name from LANDMARK_INDICES

    Returns:
        focused_poses: poses with non-relevant landmarks set to 0
    """
    if part not in LANDMARK_INDICES:
        raise ValueError(f"Unknown body part: {part}. Available: {list(LANDMARK_INDICES.keys())}")

    landmarks = LANDMARK_INDICES[part]
    focused = np.zeros_like(poses)

    # Copy only the relevant landmarks
    for idx in landmarks:
        if idx < poses.shape[1]:  # Safety check
            focused[:, idx, :] = poses[:, idx, :]

    return focused


def calculate_accuracy_metrics(reference_poses, user_poses):
    """
    Calculate detailed accuracy metrics for pose comparison.

    Args:
        reference_poses: np.array of shape (n_frames, 33, 3)
        user_poses: np.array of shape (m_frames, 33, 3)

    Returns:
        Dictionary with multiple accuracy metrics
    """
    metrics = {}

    # Overall DTW score
    metrics['dtw_score'] = compare_sign_sequences(
        reference_poses, user_poses, method='dtw', use_hand_focus=False
    )

    # Hand-focused DTW score
    metrics['hand_dtw_score'] = compare_sign_sequences(
        reference_poses, user_poses, method='dtw', use_hand_focus=True
    )

    # Upper body DTW score
    ref_upper = focus_on_body_part(reference_poses, 'upper_body')
    user_upper = focus_on_body_part(user_poses, 'upper_body')
    metrics['upper_body_score'] = compare_sign_sequences(
        ref_upper, user_upper, method='dtw', use_hand_focus=False
    )

    # Euclidean distance (faster, less accurate)
    metrics['euclidean_score'] = compare_sign_sequences(
        reference_poses, user_poses, method='euclidean', use_hand_focus=False
    )

    # Timing comparison (number of frames)
    metrics['frame_count_ratio'] = len(user_poses) / max(1, len(reference_poses))

    # Weighted final score (prioritize hand movements)
    metrics['weighted_score'] = (
        0.5 * metrics['hand_dtw_score'] +
        0.3 * metrics['upper_body_score'] +
        0.2 * metrics['dtw_score']
    )

    return metrics


# Testing code
if __name__ == '__main__':
    # Test the comparison engine
    print("Testing pose comparison engine...")

    # Create test data
    n_frames_ref = 30
    n_frames_user = 32
    n_landmarks = 33

    # Reference pose (dummy data)
    ref_poses = np.random.rand(n_frames_ref, n_landmarks, 3)
    ref_poses[:, :, 2] = np.random.rand(n_frames_ref, n_landmarks) * 0.9 + 0.1

    # User pose - very similar to reference
    user_poses_similar = ref_poses.copy()
    user_poses_similar[:, :, :2] += np.random.normal(0, 0.02, (n_frames_ref, n_landmarks, 2))
    user_poses_similar = np.vstack([user_poses_similar, np.random.rand(2, n_landmarks, 3)])

    # User pose - very different from reference
    user_poses_different = np.random.rand(n_frames_user, n_landmarks, 3)
    user_poses_different[:, :, 2] = np.random.rand(n_frames_user, n_landmarks) * 0.9 + 0.1

    # Test similar poses
    score_similar = compare_sign_sequences(ref_poses, user_poses_similar)
    print(f"Similar poses score: {score_similar:.1f} (should be high, >80)")

    # Test different poses
    score_different = compare_sign_sequences(ref_poses, user_poses_different)
    print(f"Different poses score: {score_different:.1f} (should be low, <30)")

    # Test identical poses
    score_identical = compare_sign_sequences(ref_poses, ref_poses)
    print(f"Identical poses score: {score_identical:.1f} (should be high, >95)")

    # Test detailed metrics
    metrics = calculate_accuracy_metrics(ref_poses, user_poses_similar)
    print(f"\nDetailed metrics for similar poses:")
    for key, value in metrics.items():
        print(f"  {key}: {value:.2f}")
