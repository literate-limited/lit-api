"""
Magic Trick Learning Module - Computer Vision based magic trick instruction

Uses pose detection and hand tracking to teach and verify magic tricks.
Each trick is defined as a sequence of hand states and positions.
"""

import json
import numpy as np
from dataclasses import dataclass, asdict
from typing import List, Dict, Tuple
from scipy.spatial.distance import euclidean


@dataclass
class HandState:
    """Represents the state of hands at a specific moment in a trick."""
    name: str  # e.g., "palm_open", "fist_closed", "fingers_spread"
    hand: str  # "right", "left", or "both"
    position: str  # e.g., "center", "chest_level", "mouth", "at_side"
    finger_configuration: str  # "open", "closed", "spread", "pinched"
    visibility_required: float = 0.7  # Minimum pose confidence needed
    tolerance: float = 0.15  # Tolerance for position variance


@dataclass
class TrickStep:
    """A single step in a magic trick sequence."""
    order: int
    duration_frames: int  # Expected duration in video frames
    hand_states: List[HandState]
    description: str
    key_points: List[str]  # What to watch for


class MagicTrickDefinition:
    """Defines a complete magic trick with its sequence of steps."""

    def __init__(self, name: str, difficulty: int, description: str, steps: List[TrickStep]):
        self.name = name
        self.difficulty = difficulty
        self.description = description
        self.steps = sorted(steps, key=lambda s: s.order)

    def to_json(self) -> str:
        """Serialize trick to JSON."""
        return json.dumps({
            'name': self.name,
            'difficulty': self.difficulty,
            'description': self.description,
            'steps': [
                {
                    'order': step.order,
                    'duration_frames': step.duration_frames,
                    'hand_states': [asdict(hs) for hs in step.hand_states],
                    'description': step.description,
                    'key_points': step.key_points
                }
                for step in self.steps
            ]
        })

    @staticmethod
    def from_json(json_str: str) -> 'MagicTrickDefinition':
        """Deserialize trick from JSON."""
        data = json.loads(json_str)
        steps = []
        for step_data in data['steps']:
            hand_states = [
                HandState(
                    name=hs['name'],
                    hand=hs['hand'],
                    position=hs['position'],
                    finger_configuration=hs['finger_configuration'],
                    visibility_required=hs.get('visibility_required', 0.7),
                    tolerance=hs.get('tolerance', 0.15)
                )
                for hs in step_data['hand_states']
            ]
            steps.append(TrickStep(
                order=step_data['order'],
                duration_frames=step_data['duration_frames'],
                hand_states=hand_states,
                description=step_data['description'],
                key_points=step_data['key_points']
            ))
        return MagicTrickDefinition(
            name=data['name'],
            difficulty=data['difficulty'],
            description=data['description'],
            steps=steps
        )


class MagicTrickScorer:
    """Scores user performance on magic tricks using pose detection."""

    def __init__(self):
        # Hand landmark indices in MediaPipe (33-point model)
        self.RIGHT_WRIST = 16
        self.LEFT_WRIST = 15
        self.RIGHT_HAND_LANDMARKS = list(range(16, 23))  # 7 points
        self.LEFT_HAND_LANDMARKS = list(range(16, 23))   # Simplified - same indices

        # Body reference points for positioning
        self.NECK = 1
        self.RIGHT_SHOULDER = 12
        self.LEFT_SHOULDER = 11
        self.MOUTH = 9  # Approximate

    def extract_hand_position(self, poses: np.ndarray, hand: str = "right") -> Dict:
        """
        Extract hand position and configuration from pose sequence.

        Args:
            poses: np.array of shape (n_frames, 33, 3) - pose sequence
            hand: "right" or "left"

        Returns:
            Dict with position metrics
        """
        if poses.shape[0] == 0:
            return None

        # Get wrist position
        wrist_idx = self.RIGHT_WRIST if hand == "right" else self.LEFT_WRIST
        wrist_trajectory = poses[:, wrist_idx, :2]  # (n_frames, 2)

        # Average position over sequence
        avg_x = np.nanmean(wrist_trajectory[:, 0])
        avg_y = np.nanmean(wrist_trajectory[:, 1])

        # Classify position
        position = self._classify_position(avg_x, avg_y, poses)

        # Analyze hand openness using spread of finger landmarks
        hand_indices = self.RIGHT_HAND_LANDMARKS if hand == "right" else self.LEFT_HAND_LANDMARKS
        finger_spread = self._calculate_hand_openness(poses, hand_indices)

        return {
            'avg_x': avg_x,
            'avg_y': avg_y,
            'position': position,
            'openness': finger_spread,
            'trajectory_length': self._trajectory_length(wrist_trajectory),
            'visibility_avg': np.nanmean(poses[:, wrist_idx, 2])
        }

    def _classify_position(self, x: float, y: float, poses: np.ndarray) -> str:
        """Classify hand position relative to body."""
        neck_y = np.nanmean(poses[:, self.NECK, 1])
        mouth_y = np.nanmean(poses[:, self.MOUTH, 1])
        shoulder_x = np.nanmean(poses[:, self.RIGHT_SHOULDER, 0])

        if y < mouth_y - 0.1:
            return "above_head"
        elif y < neck_y - 0.05:
            return "face_level"
        elif y < shoulder_x + 0.2:
            return "chest_level"
        else:
            return "waist_level"

    def _calculate_hand_openness(self, poses: np.ndarray, hand_indices: List[int]) -> float:
        """Calculate hand openness (0=closed fist, 1=fully open)."""
        # Extract hand landmarks
        hand_landmarks = poses[:, hand_indices, :2]  # (n_frames, 7, 2)

        # Calculate spread (distance between fingers)
        spread_scores = []
        for frame in hand_landmarks:
            if np.all(~np.isnan(frame)):
                # Calculate bounding box of hand
                min_x, min_y = np.min(frame, axis=0)
                max_x, max_y = np.max(frame, axis=0)
                spread = ((max_x - min_x) + (max_y - min_y)) / 2
                spread_scores.append(spread)

        if not spread_scores:
            return 0.5

        avg_spread = np.mean(spread_scores)
        # Normalize to 0-1 (calibrated empirically)
        openness = min(1.0, max(0.0, avg_spread / 0.3))
        return openness

    def _trajectory_length(self, trajectory: np.ndarray) -> float:
        """Calculate total path length of hand trajectory."""
        if trajectory.shape[0] < 2 or np.any(np.isnan(trajectory)):
            return 0.0

        distances = np.sqrt(np.sum(np.diff(trajectory, axis=0)**2, axis=1))
        return float(np.sum(distances))

    def score_step(self, user_poses: np.ndarray, step: TrickStep, reference_metrics: Dict = None) -> Tuple[float, Dict]:
        """
        Score a user's performance on a single trick step.

        Args:
            user_poses: np.array of shape (n_frames, 33, 3)
            step: TrickStep definition
            reference_metrics: Optional reference metrics for comparison

        Returns:
            (score, details) - score 0-100 and scoring breakdown
        """
        if user_poses.shape[0] == 0:
            return (0.0, {'error': 'No pose data'})

        details = {'step': step.order, 'hand_states': []}
        step_scores = []

        # Score each hand state in this step
        for hand_state in step.hand_states:
            hand = hand_state.hand

            # Extract hand metrics
            metrics = self.extract_hand_position(user_poses, hand)
            if metrics is None:
                step_scores.append(0.0)
                continue

            # Check visibility
            if metrics['visibility_avg'] < hand_state.visibility_required:
                step_scores.append(20.0)  # Partial credit for low visibility
                details['hand_states'].append({
                    'hand': hand,
                    'score': 20.0,
                    'reason': 'Low visibility'
                })
                continue

            # Score based on hand state requirements
            score = self._score_hand_state(metrics, hand_state)
            step_scores.append(score)
            details['hand_states'].append({
                'hand': hand,
                'score': score,
                'expected': hand_state.name,
                'metrics': metrics
            })

        # Average score across hand states in step
        avg_score = float(np.mean(step_scores)) if step_scores else 0.0

        # Check sequence duration (if too fast or too slow, reduce score)
        expected_frames = step.duration_frames
        actual_frames = user_poses.shape[0]
        duration_penalty = abs(actual_frames - expected_frames) / (expected_frames + 1)
        duration_penalty = min(20.0, duration_penalty * 100)  # Max 20 point penalty

        final_score = max(0.0, avg_score - duration_penalty)
        details['duration_penalty'] = duration_penalty
        details['expected_frames'] = expected_frames
        details['actual_frames'] = actual_frames

        return (final_score, details)

    def _score_hand_state(self, metrics: Dict, hand_state: HandState) -> float:
        """Score hand metrics against expected hand state."""
        score = 100.0

        # Score based on finger configuration
        openness = metrics['openness']
        if hand_state.finger_configuration == "open":
            # Should be open (openness > 0.6)
            if openness < 0.6:
                score -= 30.0
        elif hand_state.finger_configuration == "closed":
            # Should be closed (openness < 0.4)
            if openness > 0.4:
                score -= 30.0
        elif hand_state.finger_configuration == "pinched":
            # Should be slightly open (openness 0.3-0.6)
            if openness < 0.2 or openness > 0.7:
                score -= 25.0
        elif hand_state.finger_configuration == "spread":
            # Should be fully open (openness > 0.7)
            if openness < 0.7:
                score -= 25.0

        # Score based on position
        if hand_state.position != metrics['position']:
            score -= 20.0

        return max(0.0, score)

    def score_complete_trick(self, user_poses_sequence: List[np.ndarray], trick: MagicTrickDefinition) -> Tuple[float, Dict]:
        """
        Score complete trick performance.

        Args:
            user_poses_sequence: List of pose arrays, one per trick step
            trick: MagicTrickDefinition

        Returns:
            (total_score, detailed_breakdown)
        """
        if len(user_poses_sequence) != len(trick.steps):
            return (0.0, {'error': f'Expected {len(trick.steps)} steps, got {len(user_poses_sequence)}'})

        step_scores = []
        step_details = []

        for i, (user_poses, step) in enumerate(zip(user_poses_sequence, trick.steps)):
            score, details = self.score_step(user_poses, step)
            step_scores.append(score)
            step_details.append(details)

        # Overall score is weighted average (early steps more important)
        weights = np.linspace(0.8, 1.2, len(step_scores))  # Later steps weighted slightly higher
        weights /= np.sum(weights)  # Normalize
        total_score = float(np.average(step_scores, weights=weights))

        return (total_score, {
            'total_score': total_score,
            'step_scores': step_scores,
            'step_details': step_details,
            'difficulty': trick.difficulty
        })


# Pre-defined magic tricks

def create_coin_vanish() -> MagicTrickDefinition:
    """Coin vanish - a classic close-up magic trick."""
    steps = [
        TrickStep(
            order=1,
            duration_frames=10,
            hand_states=[
                HandState(
                    name="palm_open",
                    hand="right",
                    position="chest_level",
                    finger_configuration="open",
                    visibility_required=0.8
                )
            ],
            description="Show open palm with coin visible",
            key_points=["Hand open and visible", "Coin visible in palm"]
        ),
        TrickStep(
            order=2,
            duration_frames=15,
            hand_states=[
                HandState(
                    name="closing",
                    hand="right",
                    position="chest_level",
                    finger_configuration="closed",
                    visibility_required=0.7
                )
            ],
            description="Close hand into fist",
            key_points=["Smooth closing motion", "Fingers coming together"]
        ),
        TrickStep(
            order=3,
            duration_frames=20,
            hand_states=[
                HandState(
                    name="fist_closed",
                    hand="right",
                    position="face_level",
                    finger_configuration="closed",
                    visibility_required=0.6
                )
            ],
            description="Move closed fist toward face/mouth",
            key_points=["Fist moving upward", "Natural misdirection motion"]
        ),
        TrickStep(
            order=4,
            duration_frames=10,
            hand_states=[
                HandState(
                    name="palm_empty",
                    hand="right",
                    position="face_level",
                    finger_configuration="open",
                    visibility_required=0.8
                )
            ],
            description="Open palm to reveal coin is gone",
            key_points=["Hand opens suddenly", "Coin has vanished"]
        )
    ]

    return MagicTrickDefinition(
        name="Coin Vanish",
        difficulty=1,
        description="Classic coin vanish - show a coin in your open palm, close your hand, and make it disappear",
        steps=steps
    )


def create_card_force() -> MagicTrickDefinition:
    """Card force - forcing a spectator to take a specific card."""
    steps = [
        TrickStep(
            order=1,
            duration_frames=10,
            hand_states=[
                HandState(
                    name="cards_held",
                    hand="both",
                    position="chest_level",
                    finger_configuration="spread",
                    visibility_required=0.7
                )
            ],
            description="Hold deck of cards in front of spectator",
            key_points=["Cards visible and accessible", "Both hands in position"]
        ),
        TrickStep(
            order=2,
            duration_frames=15,
            hand_states=[
                HandState(
                    name="cards_splaying",
                    hand="right",
                    position="chest_level",
                    finger_configuration="spread",
                    visibility_required=0.7
                )
            ],
            description="Splay cards to show card selection",
            key_points=["Cards spread naturally", "Target card in view"]
        ),
        TrickStep(
            order=3,
            duration_frames=12,
            hand_states=[
                HandState(
                    name="hand_retreating",
                    hand="right",
                    position="waist_level",
                    finger_configuration="closed",
                    visibility_required=0.6
                )
            ],
            description="Pull hand back after spectator takes card",
            key_points=["Smooth retreat", "No fumbling"]
        )
    ]

    return MagicTrickDefinition(
        name="Card Force",
        difficulty=2,
        description="Force a spectator to take the card of your choice while appearing to give them a free selection",
        steps=steps
    )
