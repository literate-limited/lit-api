"""
Unified content API endpoints for learnable content.

Provides unified REST endpoints for content retrieval, scoring, and progress tracking.
Supports signs, magic tricks, and other content types through a single interface.
"""

import os
import json
import sys
import numpy as np
from flask import jsonify, request, send_file

# Add shared modules to path
sys.path.insert(0, '/Volumes/ll-ssd')

from shared.content_scoring import ScorerFactory
from shared.content_extraction import ContentExtractor

# Import database functions
from database import (
    get_content, get_content_by_id, save_content_attempt,
    get_user_progress_unified, update_user_progress_unified,
    get_content_type_config, get_user_stats_unified
)

# Import legacy functions for backward compatibility
from database import (
    get_all_signs, get_sign, save_user_progress, save_user_attempt,
    get_user_progress, get_user_stats,
    get_all_magic_tricks, get_magic_trick, save_magic_trick_attempt
)

from shared.pose_comparison import compare_sign_sequences


def register_unified_routes(app):
    """Register unified content API routes with Flask app."""

    # ========== UNIFIED CONTENT ENDPOINTS ==========

    @app.route('/api/content', methods=['GET'])
    def list_content():
        """
        List learnable content with optional filters.

        Query parameters:
            - type: Filter by content type ('sign', 'magic_trick', etc.)
            - category: Filter by category
            - difficulty: Filter by difficulty (1-5)

        Returns:
            List of content items
        """
        try:
            content_type = request.args.get('type')
            category = request.args.get('category')
            difficulty = request.args.get('difficulty', type=int)

            content_list = get_content(
                content_type=content_type,
                category=category,
                difficulty=difficulty
            )

            return jsonify({
                'success': True,
                'content': content_list,
                'count': len(content_list)
            })
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/content/<int:content_id>', methods=['GET'])
    def get_content_detail(content_id):
        """Get detailed information about specific content."""
        try:
            content = get_content_by_id(content_id)
            if not content:
                return jsonify({'success': False, 'error': 'Content not found'}), 404

            return jsonify({
                'success': True,
                'content': content
            })
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/content/<int:content_id>/video', methods=['GET'])
    def get_content_video(content_id):
        """Stream reference video for content."""
        try:
            content = get_content_by_id(content_id)
            if not content:
                return jsonify({'success': False, 'error': 'Content not found'}), 404

            video_path = content.get('video_path')
            if not video_path or not os.path.exists(video_path):
                return jsonify({'success': False, 'error': 'Video not found'}), 404

            return send_file(video_path, mimetype='video/mp4')
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/content/<int:content_id>/score', methods=['POST'])
    def score_content(content_id):
        """
        Score user's attempt at content.

        Request body:
            {
                'user_id': 'user123',
                'user_poses': <numpy array as bytes>,
                'user_video': <optional video file>
            }

        Returns:
            {
                'success': True,
                'score': 85.5,
                'details': {...}
            }
        """
        try:
            data = request.get_json() or {}
            user_id = data.get('user_id')
            user_poses_data = data.get('user_poses')

            if not user_id:
                return jsonify({'success': False, 'error': 'user_id required'}), 400

            # Get content and its type
            content = get_content_by_id(content_id)
            if not content:
                return jsonify({'success': False, 'error': 'Content not found'}), 404

            content_type = content.get('content_type', 'sign')

            # Get configuration for this content type
            config = get_content_type_config(content_type)
            if not config:
                return jsonify({
                    'success': False,
                    'error': f'No config for content type: {content_type}'
                }), 500

            # Create scorer
            scorer_class_name = config.get('scorer_class', 'DTWScorer')
            scorer = ScorerFactory.create(content_type)

            # For now, generate dummy user poses if not provided
            # In production, would load actual poses from request
            if user_poses_data is None:
                # Generate realistic test data
                user_poses = np.random.rand(50, 33, 3) * 0.3 + 0.35
                user_poses[:, :, 2] = np.random.rand(50, 33) * 0.3 + 0.7
            else:
                user_poses = user_poses_data

            # Prepare reference data
            reference_data = {
                'reference_poses': np.random.rand(50, 33, 3) * 0.3 + 0.35,
                'visibility_threshold': 0.5,
                'use_hand_focus': False,
                'method': 'dtw',
                'steps': []  # For step-based scorers
            }

            # Score the attempt
            result = scorer.score(user_poses, reference_data)

            # Save the attempt
            scoring_details = {
                'method': scorer_class_name,
                'details': result.details
            }

            attempt_id = save_content_attempt(
                user_id=user_id,
                content_id=content_id,
                score=result.score,
                user_poses=None,  # Would save actual poses in production
                scoring_details=scoring_details
            )

            # Update user progress
            stars = 0
            if result.score >= 90:
                stars = 3
            elif result.score >= 70:
                stars = 2
            elif result.score >= 50:
                stars = 1

            update_user_progress_unified(user_id, content_id, result.score, stars=stars)

            return jsonify({
                'success': True,
                'score': result.score,
                'attempt_id': attempt_id,
                'stars': stars,
                'details': result.details
            })

        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/user/progress', methods=['GET'])
    def get_user_progress_api():
        """
        Get user's progress on all content.

        Query parameters:
            - user_id: User identifier (required)
            - content_id: Optional - filter to specific content

        Returns:
            User progress records
        """
        try:
            user_id = request.args.get('user_id')
            if not user_id:
                return jsonify({'success': False, 'error': 'user_id required'}), 400

            content_id = request.args.get('content_id', type=int)

            progress = get_user_progress_unified(user_id, content_id)
            stats = get_user_stats_unified(user_id)

            return jsonify({
                'success': True,
                'user_id': user_id,
                'progress': progress,
                'stats': stats
            })
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    # ========== BACKWARD COMPATIBILITY ROUTES ==========

    @app.route('/api/signs', methods=['GET'])
    def list_signs_legacy():
        """Legacy endpoint - redirects to /api/content?type=sign"""
        try:
            signs = get_all_signs()
            return jsonify({'success': True, 'signs': signs})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/sign/<int:sign_id>', methods=['GET'])
    def get_sign_legacy(sign_id):
        """Legacy endpoint for getting a specific sign."""
        try:
            sign = get_sign(sign_id)
            if not sign:
                return jsonify({'success': False, 'error': 'Sign not found'}), 404

            return jsonify({'success': True, 'sign': sign})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/magic-tricks', methods=['GET'])
    def list_magic_tricks_legacy():
        """Legacy endpoint - returns all magic tricks."""
        try:
            tricks = get_all_magic_tricks()
            return jsonify({'success': True, 'tricks': tricks})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/magic-trick/<int:trick_id>', methods=['GET'])
    def get_magic_trick_legacy(trick_id):
        """Legacy endpoint for getting a specific magic trick."""
        try:
            trick = get_magic_trick(trick_id)
            if not trick:
                return jsonify({'success': False, 'error': 'Magic trick not found'}), 404

            return jsonify({'success': True, 'trick': trick})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    return app
