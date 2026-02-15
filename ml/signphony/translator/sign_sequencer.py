"""
Sign Sequencer

Manages lookup of signs from database and sequences them with proper
timing, transitions, and interpolation.
"""

import sqlite3
import json
from typing import List, Dict, Optional, Tuple
from pathlib import Path


class SignSequencer:
    """
    Handles sign database lookups and sequence timing.
    """
    
    # Default timing constants (in seconds)
    DEFAULT_SIGN_DURATION = 1.0      # Base duration for a sign
    TRANSITION_DURATION = 0.3        # Time between signs
    HOLD_DURATION = 0.1              # Hold at end of sign
    
    # Timing modifiers
    QUESTION_HOLD = 0.3              # Extra hold for questions
    NEGATION_HOLD = 0.2              # Extra hold for negation
    EMOTION_MODIFIER = 1.2           # Emotions take longer
    
    def __init__(self, db_path: str):
        """
        Initialize with database connection.
        
        Args:
            db_path: Path to SQLite database
        """
        self.db_path = db_path
        self._cache = {}  # Simple in-memory cache
    
    def _get_connection(self) -> sqlite3.Connection:
        """Get database connection."""
        return sqlite3.connect(self.db_path)
    
    def lookup_signs(self, tokens: List) -> List[Dict]:
        """
        Look up signs for a list of gloss tokens.
        
        Args:
            tokens: List of GlossToken objects
            
        Returns:
            List of sign data dictionaries
        """
        results = []
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for token in tokens:
                sign_data = self._lookup_single_sign(cursor, token)
                results.append(sign_data)
        finally:
            conn.close()
        
        return results
    
    def _lookup_single_sign(self, cursor: sqlite3.Cursor, token) -> Dict:
        """
        Look up a single sign in the database.
        
        Tries multiple matching strategies:
        1. Exact gloss match
        2. Case-insensitive match
        3. Word stem match
        4. Fingerspelling fallback
        """
        gloss = token.gloss
        sign_type = token.sign_type.value if hasattr(token, 'sign_type') else 'unknown'
        
        # Strategy 1: Exact match on word column
        cursor.execute(
            "SELECT id, word, video_path, difficulty, category, reference_poses FROM signs WHERE word = ?",
            (gloss.lower(),)
        )
        row = cursor.fetchone()
        
        if not row:
            # Strategy 2: Try without common suffixes
            base_gloss = self._normalize_gloss(gloss)
            cursor.execute(
                "SELECT id, word, video_path, difficulty, category, reference_poses FROM signs WHERE word = ?",
                (base_gloss,)
            )
            row = cursor.fetchone()
        
        if not row:
            # Strategy 3: Check if any word contains the gloss
            cursor.execute(
                """SELECT id, word, video_path, difficulty, category, reference_poses 
                   FROM signs WHERE word LIKE ? ORDER BY LENGTH(word) ASC LIMIT 1""",
                (f'%{gloss.lower()}%',)
            )
            row = cursor.fetchone()
        
        if row:
            sign_id, word, video_path, difficulty, category, poses_blob = row
            
            return {
                'found': True,
                'gloss': gloss,
                'matched_word': word,
                'sign_id': sign_id,
                'video_path': video_path,
                'difficulty': difficulty,
                'category': category,
                'poses': self._deserialize_poses(poses_blob),
                'sign_type': sign_type,
                'spatial_index': getattr(token, 'spatial_index', None),
                'modifiers': getattr(token, 'modifiers', [])
            }
        else:
            # Not found - mark for fingerspelling
            return {
                'found': False,
                'gloss': gloss,
                'fallback': 'fingerspell',
                'fingerspell_sequence': list(gloss.lower()),
                'sign_type': sign_type,
                'spatial_index': getattr(token, 'spatial_index', None)
            }
    
    def _normalize_gloss(self, gloss: str) -> str:
        """
        Normalize gloss for database lookup.
        
        Removes common suffixes and variations.
        """
        gloss = gloss.lower()
        
        # Remove common suffixes
        suffixes = ['_1', '_2', '(1)', '(2)', '_v1', '_v2']
        for suffix in suffixes:
            if gloss.endswith(suffix):
                gloss = gloss[:-len(suffix)]
        
        # Handle compound glosses
        if '_' in gloss:
            # Try first part
            return gloss.split('_')[0]
        
        return gloss
    
    def _deserialize_poses(self, poses_blob: Optional[bytes]) -> Optional[List]:
        """Deserialize pose data from blob."""
        if poses_blob is None:
            return None
        
        try:
            import numpy as np
            poses = np.frombuffer(poses_blob, dtype=np.float32)
            # Assume shape (n_frames, 33, 3) for MediaPipe
            if len(poses) > 0:
                n_frames = len(poses) // (33 * 3)
                if n_frames > 0:
                    return poses.reshape(n_frames, 33, 3).tolist()
            return None
        except Exception:
            return None
    
    def calculate_timing(self, sign_sequence: List[Dict]) -> Dict:
        """
        Calculate timing for sign sequence.
        
        Returns timing information for avatar animation.
        """
        timeline = []
        current_time = 0.0
        
        for i, sign in enumerate(sign_sequence):
            # Calculate duration for this sign
            duration = self._calculate_sign_duration(sign)
            
            # Add transition time (except for first sign)
            if i > 0:
                current_time += self.TRANSITION_DURATION
            
            entry = {
                'gloss': sign.get('gloss', 'UNKNOWN'),
                'start_time': current_time,
                'end_time': current_time + duration,
                'duration': duration,
                'transition_in': self.TRANSITION_DURATION if i > 0 else 0,
                'transition_out': self.TRANSITION_DURATION if i < len(sign_sequence) - 1 else 0,
            }
            
            timeline.append(entry)
            current_time += duration
        
        return {
            'total_duration': current_time,
            'timeline': timeline,
            'sign_count': len(sign_sequence),
            'average_sign_duration': sum(t['duration'] for t in timeline) / len(timeline) if timeline else 0
        }
    
    def _calculate_sign_duration(self, sign: Dict) -> float:
        """Calculate appropriate duration for a sign."""
        duration = self.DEFAULT_SIGN_DURATION
        
        gloss = sign.get('gloss', '')
        sign_type = sign.get('sign_type', 'noun')
        modifiers = sign.get('modifiers', [])
        
        # Base duration by sign type
        type_durations = {
            'noun': 0.8,
            'verb': 1.0,
            'adjective': 0.7,
            'adverb': 0.6,
            'pronoun': 0.5,
            'time': 0.6,
            'question': 1.2,  # Questions held longer
            'classifier': 1.5,  # Classifiers are complex
            'fingerspell': 0.4,  # Per letter
            'pointing': 0.4
        }
        
        duration = type_durations.get(sign_type, 1.0)
        
        # Modifiers
        if 'NOT' in gloss or 'negation' in modifiers:
            duration += self.NEGATION_HOLD
        
        if sign_type == 'question':
            duration += self.QUESTION_HOLD
        
        if sign_type in ['adjective', 'adverb'] and any(e in gloss for e in ['HAPPY', 'SAD', 'ANGRY']):
            duration *= self.EMOTION_MODIFIER
        
        # Fingerspelling adjustment
        if sign.get('fallback') == 'fingerspell':
            letters = len(sign.get('fingerspell_sequence', []))
            duration = letters * self.DEFAULT_SIGN_DURATION * 0.4
        
        return duration
    
    def generate_interpolation(self, sign_sequence: List[Dict]) -> List[Dict]:
        """
        Generate interpolation data between signs.
        
        For avatar animation, we need to smoothly transition
        from the end pose of sign N to the start pose of sign N+1.
        """
        interpolations = []
        
        for i in range(len(sign_sequence) - 1):
            current_sign = sign_sequence[i]
            next_sign = sign_sequence[i + 1]
            
            current_poses = current_sign.get('poses')
            next_poses = next_sign.get('poses')
            
            if current_poses and next_poses:
                # Get last frame of current and first frame of next
                end_pose = current_poses[-1]  # Shape: (33, 3)
                start_pose = next_poses[0]    # Shape: (33, 3)
                
                # Generate interpolation frames
                interp_frames = self._interpolate_poses(
                    end_pose, start_pose, 
                    n_frames=int(self.TRANSITION_DURATION * 30)  # 30fps
                )
                
                interpolations.append({
                    'from_sign': current_sign['gloss'],
                    'to_sign': next_sign['gloss'],
                    'duration': self.TRANSITION_DURATION,
                    'frames': interp_frames
                })
        
        return interpolations
    
    def _interpolate_poses(self, pose_a: List, pose_b: List, n_frames: int) -> List:
        """
        Linear interpolation between two poses.
        
        Args:
            pose_a: Starting pose (33, 3)
            pose_b: Ending pose (33, 3)
            n_frames: Number of frames to generate
            
        Returns:
            List of interpolated poses
        """
        import numpy as np
        
        a = np.array(pose_a)
        b = np.array(pose_b)
        
        frames = []
        for t in range(n_frames):
            alpha = t / (n_frames - 1) if n_frames > 1 else 0
            interp = a * (1 - alpha) + b * alpha
            frames.append(interp.tolist())
        
        return frames
    
    def get_available_signs(self) -> List[str]:
        """Get list of all available sign words in database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT word FROM signs ORDER BY word")
            return [row[0] for row in cursor.fetchall()]
        finally:
            conn.close()
    
    def search_signs(self, query: str, limit: int = 10) -> List[Dict]:
        """Search for signs by partial match."""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                """SELECT id, word, difficulty, category 
                   FROM signs 
                   WHERE word LIKE ? 
                   ORDER BY word 
                   LIMIT ?""",
                (f'%{query.lower()}%', limit)
            )
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    'id': row[0],
                    'word': row[1],
                    'difficulty': row[2],
                    'category': row[3]
                })
            
            return results
        finally:
            conn.close()
    
    def get_sign_stats(self) -> Dict:
        """Get statistics about available signs."""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT COUNT(*) FROM signs")
            total = cursor.fetchone()[0]
            
            cursor.execute("SELECT category, COUNT(*) FROM signs GROUP BY category")
            by_category = dict(cursor.fetchall())
            
            cursor.execute("SELECT difficulty, COUNT(*) FROM signs GROUP BY difficulty")
            by_difficulty = dict(cursor.fetchall())
            
            return {
                'total_signs': total,
                'by_category': by_category,
                'by_difficulty': by_difficulty
            }
        finally:
            conn.close()
