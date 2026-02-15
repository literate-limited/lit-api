import sqlite3
import os
import json
from datetime import datetime

DB_PATH = 'auslan_game.db'

def get_db_connection():
    """Get a connection to the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create signs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS signs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL UNIQUE,
            video_path TEXT NOT NULL,
            difficulty INTEGER DEFAULT 1,
            category TEXT,
            reference_poses BLOB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Create user_progress table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            sign_id INTEGER,
            attempts INTEGER DEFAULT 0,
            best_score REAL DEFAULT 0.0,
            completed BOOLEAN DEFAULT 0,
            completed_at TIMESTAMP,
            FOREIGN KEY (sign_id) REFERENCES signs(id)
        )
    ''')

    # Create user_attempts table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            sign_id INTEGER,
            score REAL,
            user_poses BLOB,
            video_blob BLOB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sign_id) REFERENCES signs(id)
        )
    ''')

    # Create magic_tricks table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS magic_tricks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            difficulty INTEGER DEFAULT 1,
            category TEXT,
            trick_definition TEXT,
            reference_poses BLOB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Create magic_trick_attempts table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS magic_trick_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            trick_id INTEGER,
            score REAL,
            user_poses BLOB,
            step_scores TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (trick_id) REFERENCES magic_tricks(id)
        )
    ''')

    conn.commit()
    conn.close()
    print("Database initialized successfully")

def add_sign(word, video_path, difficulty=1, category=None, reference_poses=None):
    """Add a new sign to the database."""
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute('''
            INSERT INTO signs (word, video_path, difficulty, category, reference_poses)
            VALUES (?, ?, ?, ?, ?)
        ''', (word, video_path, difficulty, category, reference_poses))
        conn.commit()
        sign_id = cursor.lastrowid
        conn.close()
        return sign_id
    except sqlite3.IntegrityError:
        conn.close()
        print(f"Sign '{word}' already exists")
        return None

def get_all_signs():
    """Get all signs from the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, word, difficulty, category FROM signs ORDER BY id')
    signs = cursor.fetchall()
    conn.close()
    return [dict(sign) for sign in signs]

def get_sign(sign_id):
    """Get a specific sign by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, word, video_path, difficulty, category FROM signs WHERE id = ?', (sign_id,))
    sign = cursor.fetchone()
    conn.close()
    return dict(sign) if sign else None

def get_sign_by_word(word):
    """Get a sign by word."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, word, video_path, difficulty, category FROM signs WHERE word = ?', (word,))
    sign = cursor.fetchone()
    conn.close()
    return dict(sign) if sign else None

def save_user_progress(user_id, sign_id, score, completed=False):
    """Save or update user progress for a sign."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Check if progress already exists
    cursor.execute('SELECT id, best_score, attempts FROM user_progress WHERE user_id = ? AND sign_id = ?',
                   (user_id, sign_id))
    existing = cursor.fetchone()

    if existing:
        # Update existing record
        best_score = max(existing['best_score'], score)
        attempts = existing['attempts'] + 1
        completed_at = datetime.now() if completed and not existing['completed'] else None

        cursor.execute('''
            UPDATE user_progress
            SET best_score = ?, attempts = ?, completed = ?, completed_at = COALESCE(completed_at, ?)
            WHERE user_id = ? AND sign_id = ?
        ''', (best_score, attempts, int(completed), completed_at, user_id, sign_id))
    else:
        # Insert new record
        completed_at = datetime.now() if completed else None
        cursor.execute('''
            INSERT INTO user_progress (user_id, sign_id, best_score, attempts, completed, completed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (user_id, sign_id, score, 1, int(completed), completed_at))

    conn.commit()
    conn.close()

def save_user_attempt(user_id, sign_id, score, user_poses=None, video_blob=None):
    """Save a user's attempt at a sign."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        INSERT INTO user_attempts (user_id, sign_id, score, user_poses, video_blob)
        VALUES (?, ?, ?, ?, ?)
    ''', (user_id, sign_id, score, user_poses, video_blob))

    conn.commit()
    conn.close()

def get_user_progress(user_id):
    """Get all progress for a user."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT up.sign_id, s.word, up.best_score, up.attempts, up.completed, up.completed_at
        FROM user_progress up
        JOIN signs s ON up.sign_id = s.id
        WHERE up.user_id = ?
        ORDER BY up.id
    ''', (user_id,))

    progress = cursor.fetchall()
    conn.close()
    return [dict(p) for p in progress]

def get_user_stats(user_id):
    """Get summary stats for a user."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT COUNT(*) as total, SUM(completed) as completed, AVG(best_score) as avg_score
        FROM user_progress
        WHERE user_id = ?
    ''', (user_id,))

    stats = cursor.fetchone()
    conn.close()

    return {
        'total_signs': stats['total'] or 0,
        'signs_completed': stats['completed'] or 0,
        'average_score': stats['avg_score'] or 0.0
    }

def add_magic_trick(name, description, difficulty, category, trick_definition, reference_poses=None):
    """Add a new magic trick to the database."""
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute('''
            INSERT INTO magic_tricks (name, description, difficulty, category, trick_definition, reference_poses)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (name, description, difficulty, category, trick_definition, reference_poses))
        conn.commit()
        trick_id = cursor.lastrowid
        conn.close()
        return trick_id
    except sqlite3.IntegrityError:
        conn.close()
        print(f"Magic trick '{name}' already exists")
        return None

def get_all_magic_tricks():
    """Get all magic tricks from the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, difficulty, category, description FROM magic_tricks ORDER BY id')
    tricks = cursor.fetchall()
    conn.close()
    return [dict(trick) for trick in tricks]

def get_magic_trick(trick_id):
    """Get a specific magic trick by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, description, difficulty, category, trick_definition FROM magic_tricks WHERE id = ?', (trick_id,))
    trick = cursor.fetchone()
    conn.close()
    return dict(trick) if trick else None

def save_magic_trick_attempt(user_id, trick_id, score, user_poses=None, step_scores=None):
    """Save a user's attempt at a magic trick."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        INSERT INTO magic_trick_attempts (user_id, trick_id, score, user_poses, step_scores)
        VALUES (?, ?, ?, ?, ?)
    ''', (user_id, trick_id, score, user_poses, step_scores))

    conn.commit()
    conn.close()

# ============================================================================
# UNIFIED CONTENT API (NEW SCHEMA)
# These functions work with the unified learnable_content schema
# ============================================================================

def get_content(content_type=None, category=None, difficulty=None):
    """
    Get learnable content with optional filters.

    Args:
        content_type: Filter by type ('sign', 'magic_trick', etc.) - optional
        category: Filter by category - optional
        difficulty: Filter by difficulty - optional

    Returns:
        List of content items as dictionaries
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    query = 'SELECT id, content_type, name, description, difficulty, category FROM learnable_content WHERE 1=1'
    params = []

    if content_type:
        query += ' AND content_type = ?'
        params.append(content_type)

    if category:
        query += ' AND category = ?'
        params.append(category)

    if difficulty is not None:
        query += ' AND difficulty = ?'
        params.append(difficulty)

    query += ' ORDER BY id'

    cursor.execute(query, params)
    results = cursor.fetchall()
    conn.close()

    return [dict(row) for row in results]


def get_content_by_id(content_id):
    """Get a specific content item by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT id, content_type, name, description, difficulty, category, video_path
        FROM learnable_content WHERE id = ?
    ''', (content_id,))

    result = cursor.fetchone()
    conn.close()

    return dict(result) if result else None


def save_content_attempt(user_id, content_id, score, user_poses=None, scoring_details=None):
    """
    Save a user's attempt at content.

    Args:
        user_id: User identifier
        content_id: Content identifier
        score: Numeric score (0-100)
        user_poses: Serialized poses (optional)
        scoring_details: Scoring breakdown dict (optional)

    Returns:
        Attempt ID
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    details_json = json.dumps(scoring_details or {})

    cursor.execute('''
        INSERT INTO content_attempts (user_id, content_id, score, user_poses, scoring_details)
        VALUES (?, ?, ?, ?, ?)
    ''', (user_id, content_id, score, user_poses, details_json))

    conn.commit()
    attempt_id = cursor.lastrowid
    conn.close()

    return attempt_id


def get_user_progress_unified(user_id, content_id=None):
    """
    Get user progress for unified content.

    Args:
        user_id: User identifier
        content_id: Optional - filter to specific content

    Returns:
        List of progress records
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    query = '''
        SELECT up.id, up.user_id, up.content_id, lc.name, lc.content_type,
               up.attempts, up.best_score, up.completed, up.stars_earned, up.last_practiced
        FROM user_progress_v2 up
        JOIN learnable_content lc ON up.content_id = lc.id
        WHERE up.user_id = ?
    '''
    params = [user_id]

    if content_id is not None:
        query += ' AND up.content_id = ?'
        params.append(content_id)

    query += ' ORDER BY up.id'

    cursor.execute(query, params)
    results = cursor.fetchall()
    conn.close()

    return [dict(row) for row in results]


def update_user_progress_unified(user_id, content_id, score, stars=0):
    """
    Update or create user progress in unified schema.

    Args:
        user_id: User identifier
        content_id: Content identifier
        score: Numeric score (0-100)
        stars: Star rating (0-3)
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # Check if record exists
    cursor.execute('''
        SELECT id, best_score, attempts FROM user_progress_v2
        WHERE user_id = ? AND content_id = ?
    ''', (user_id, content_id))

    existing = cursor.fetchone()
    now = datetime.now()

    if existing:
        # Update existing
        best_score = max(existing['best_score'], score)
        attempts = existing['attempts'] + 1
        completed = score >= 70
        completed_at = now if completed and not existing.get('completed') else None

        cursor.execute('''
            UPDATE user_progress_v2
            SET best_score = ?, attempts = ?, completed = ?,
                completed_at = COALESCE(completed_at, ?), stars_earned = ?, last_practiced = ?
            WHERE user_id = ? AND content_id = ?
        ''', (best_score, attempts, int(completed), completed_at, stars, now, user_id, content_id))
    else:
        # Create new
        completed = score >= 70
        completed_at = now if completed else None

        cursor.execute('''
            INSERT INTO user_progress_v2
            (user_id, content_id, attempts, best_score, completed, completed_at, stars_earned, last_practiced)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        ''', (user_id, content_id, score, int(completed), completed_at, stars, now))

    conn.commit()
    conn.close()


def get_content_type_config(content_type):
    """
    Get configuration for a content type.

    Args:
        content_type: Content type identifier

    Returns:
        Dict with scorer_class and config settings, or None if not found
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT content_type, scorer_class, extraction_config, scoring_config
        FROM content_type_configs WHERE content_type = ?
    ''', (content_type,))

    result = cursor.fetchone()
    conn.close()

    if not result:
        return None

    return {
        'content_type': result['content_type'],
        'scorer_class': result['scorer_class'],
        'extraction_config': json.loads(result['extraction_config'] or '{}'),
        'scoring_config': json.loads(result['scoring_config'] or '{}')
    }


def get_user_stats_unified(user_id):
    """
    Get aggregated stats for user across all content types.

    Args:
        user_id: User identifier

    Returns:
        Dict with stats
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT
            COUNT(*) as total_content,
            SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed_content,
            AVG(best_score) as avg_score,
            SUM(stars_earned) as total_stars
        FROM user_progress_v2
        WHERE user_id = ?
    ''', (user_id,))

    stats = cursor.fetchone()
    conn.close()

    return {
        'total_content': stats['total_content'] or 0,
        'completed_content': stats['completed_content'] or 0,
        'average_score': float(stats['avg_score'] or 0.0),
        'total_stars': stats['total_stars'] or 0
    }


if __name__ == '__main__':
    init_db()
