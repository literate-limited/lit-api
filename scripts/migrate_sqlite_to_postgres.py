#!/usr/bin/env python3
"""
One-off migration utility:
- Reads legacy SQLite DBs (app + curriculum) and loads them into Postgres.

This repo migrated runtime storage to Postgres, but older deployments may still
have data in SQLite (e.g. mvp-dev.db, languages_curriculum.db).

Usage examples:
  export DATABASE_URL="postgres://postgres@localhost:5432/lit_dev"
  python3 api/scripts/migrate_sqlite_to_postgres.py --app-sqlite api/mvp-dev.db
  python3 api/scripts/migrate_sqlite_to_postgres.py --curriculum-sqlite api/languages_curriculum.db
  python3 api/scripts/migrate_sqlite_to_postgres.py --all --wipe
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from typing import Any, Iterable, List, Optional, Sequence, Tuple


def sql_quote(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    return "'" + s.replace("'", "''") + "'"

def sql_int(value: Any) -> str:
    if value is None or value == "":
        return "NULL"
    try:
        return str(int(value))
    except Exception:
        return "NULL"


def sql_float(value: Any) -> str:
    if value is None or value == "":
        return "NULL"
    try:
        return str(float(value))
    except Exception:
        return "NULL"


def sql_jsonb(value: Any) -> str:
    if value is None or value == "":
        return "NULL"

    if isinstance(value, (dict, list)):
        return sql_quote(json.dumps(value)) + "::jsonb"

    # value likely comes from SQLite TEXT
    s = str(value)
    try:
        json.loads(s)
        return sql_quote(s) + "::jsonb"
    except Exception:
        # Store as a JSON string to avoid hard failures on malformed legacy data
        return sql_quote(json.dumps(s)) + "::jsonb"


def parse_json_list(value: Any) -> List[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(x) for x in value]
    s = str(value)
    try:
        loaded = json.loads(s)
        if isinstance(loaded, list):
            return [str(x) for x in loaded]
    except Exception:
        pass
    return []


def sql_text_array(value: Any) -> str:
    items = parse_json_list(value)
    if not items:
        return "'{}'::text[]"
    return "ARRAY[" + ",".join(sql_quote(x) for x in items) + "]::text[]"


def sql_uuid_array(value: Any) -> str:
    items = parse_json_list(value)
    if not items:
        return "'{}'::uuid[]"
    return "ARRAY[" + ",".join(sql_quote(x) for x in items) + "]::uuid[]"


def rows(conn: sqlite3.Connection, query: str, params: Sequence[Any] = ()) -> List[sqlite3.Row]:
    cur = conn.execute(query, params)
    return cur.fetchall()


def psql_run(database_url: str, sql: str) -> None:
    proc = subprocess.run(
        ["psql", database_url, "-v", "ON_ERROR_STOP=1", "-q"],
        input=sql.encode("utf-8"),
        stdout=sys.stdout,
        stderr=sys.stderr,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql exited with code {proc.returncode}")


def migrate_app(sqlite_path: str, wipe: bool) -> str:
    if not os.path.exists(sqlite_path):
        raise FileNotFoundError(sqlite_path)

    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row

    out: List[str] = []
    out.append("-- App DB migration from SQLite: " + sqlite_path)
    out.append("BEGIN;")

    if wipe:
        # CASCADE handles dependent tables.
        out.append(
            "TRUNCATE "
            "ai_response, message_analysis, message_segment, message, "
            "chat_rooms, enrollments, classes, users, "
            "level_progress, level, unit_assignment, unit, topic_hierarchy, "
            "student_assessment "
            "CASCADE;"
        )

    # users
    user_rows = rows(
        conn,
        """
        SELECT id, firstName, middleName, lastName, email, role, passwordHash, createdAt, lastSeen
        FROM user
        """,
    )
    user_ids = {str(r["id"]) for r in user_rows if r["id"]}

    for r in user_rows:
        out.append(
            "INSERT INTO users "
            "(id, first_name, middle_name, last_name, email, role, password_hash, created_at, last_seen) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["firstName"]),
                    sql_quote(r["middleName"]),
                    sql_quote(r["lastName"]),
                    sql_quote(str(r["email"]).lower().strip()),
                    sql_quote(r["role"]),
                    sql_quote(r["passwordHash"]),
                    sql_quote(r["createdAt"]) + "::timestamptz" if r["createdAt"] else "NOW()",
                    sql_quote(r["lastSeen"]) + "::timestamptz" if r["lastSeen"] else "NULL",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # classes
    class_rows = rows(
        conn,
        """
        SELECT id, teacherId, name, code, createdAt, year_level, class_identifier, subject
        FROM class
        """,
    )
    class_ids = {str(r["id"]) for r in class_rows if r["id"]}

    for r in class_rows:
        if r["teacherId"] and str(r["teacherId"]) not in user_ids:
            out.append(
                f"-- Skipping class {r['id']}: teacherId {r['teacherId']} missing from users"
            )
            continue
        out.append(
            "INSERT INTO classes "
            "(id, teacher_id, name, code, created_at, year_level, class_identifier, subject) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["teacherId"]) + "::uuid",
                    sql_quote(r["name"]),
                    sql_quote(r["code"]),
                    sql_quote(r["createdAt"]) + "::timestamptz" if r["createdAt"] else "NOW()",
                    sql_int(r["year_level"]),
                    sql_quote(r["class_identifier"]),
                    sql_quote(r["subject"]),
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # enrollments
    enrollment_rows = rows(
        conn,
        """
        SELECT id, classId, studentId, createdAt
        FROM enrollment
        """,
    )
    for r in enrollment_rows:
        if r["classId"] and str(r["classId"]) not in class_ids:
            out.append(
                f"-- Skipping enrollment {r['id']}: classId {r['classId']} missing from classes"
            )
            continue
        if r["studentId"] and str(r["studentId"]) not in user_ids:
            out.append(
                f"-- Skipping enrollment {r['id']}: studentId {r['studentId']} missing from users"
            )
            continue
        out.append(
            "INSERT INTO enrollments (id, class_id, student_id, created_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["classId"]) + "::uuid",
                    sql_quote(r["studentId"]) + "::uuid",
                    sql_quote(r["createdAt"]) + "::timestamptz" if r["createdAt"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (class_id, student_id) DO NOTHING;"
        )

    # chat rooms
    room_rows = rows(
        conn,
        """
        SELECT id, classId, studentId, type, ai_context, language_code, assessment_interval, last_assessment_at, createdAt
        FROM chat_room
        """,
    )
    room_ids = {str(r["id"]) for r in room_rows if r["id"]}

    for r in room_rows:
        if r["classId"] and str(r["classId"]) not in class_ids:
            out.append(f"-- Skipping room {r['id']}: classId {r['classId']} missing")
            continue
        if r["studentId"] and str(r["studentId"]) not in user_ids:
            out.append(f"-- Skipping room {r['id']}: studentId {r['studentId']} missing")
            continue
        out.append(
            "INSERT INTO chat_rooms "
            "(id, class_id, student_id, type, ai_context, language_code, assessment_interval, last_assessment_at, created_at) "
            "VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["classId"]) + "::uuid",
                    (sql_quote(r["studentId"]) + "::uuid") if r["studentId"] else "NULL",
                    sql_quote(r["type"]),
                    sql_quote(r["ai_context"]),
                    sql_quote(r["language_code"]),
                    sql_int(r["assessment_interval"]),
                    sql_quote(r["last_assessment_at"]) + "::timestamptz" if r["last_assessment_at"] else "NULL",
                    sql_quote(r["createdAt"]) + "::timestamptz" if r["createdAt"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # messages
    message_rows = rows(
        conn,
        """
        SELECT id, room_id, sender_id, sender_role, message_type, raw_text, target_language, created_at
        FROM message
        """,
    )
    message_ids = {str(r["id"]) for r in message_rows if r["id"]}

    for r in message_rows:
        if r["room_id"] and str(r["room_id"]) not in room_ids:
            out.append(f"-- Skipping message {r['id']}: room_id {r['room_id']} missing")
            continue
        if r["sender_id"] and str(r["sender_id"]) not in user_ids:
            out.append(f"-- Skipping message {r['id']}: sender_id {r['sender_id']} missing")
            continue
        out.append(
            "INSERT INTO message "
            "(id, room_id, sender_id, sender_role, message_type, raw_text, target_language, created_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["room_id"]) + "::uuid",
                    sql_quote(r["sender_id"]) + "::uuid",
                    sql_quote(r["sender_role"]),
                    sql_quote(r["message_type"]),
                    sql_quote(r["raw_text"]),
                    sql_quote(r["target_language"]),
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # message segments
    segment_rows = rows(
        conn,
        """
        SELECT id, message_id, segment_index, segment_text, language_code, char_start, char_end,
               is_error, error_type, correction, error_explanation, is_new_vocabulary, created_at
        FROM message_segment
        """,
    )
    for r in segment_rows:
        if r["message_id"] and str(r["message_id"]) not in message_ids:
            out.append(
                f"-- Skipping message_segment {r['id']}: message_id {r['message_id']} missing"
            )
            continue
        out.append(
            "INSERT INTO message_segment "
            "(id, message_id, segment_index, segment_text, language_code, char_start, char_end, "
            " is_error, error_type, correction, error_explanation, is_new_vocabulary, created_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["message_id"]) + "::uuid",
                    str(r["segment_index"]),
                    sql_quote(r["segment_text"]),
                    sql_quote(r["language_code"]),
                    "NULL" if r["char_start"] is None else str(r["char_start"]),
                    "NULL" if r["char_end"] is None else str(r["char_end"]),
                    "TRUE" if r["is_error"] else "FALSE",
                    sql_quote(r["error_type"]),
                    sql_quote(r["correction"]),
                    sql_quote(r["error_explanation"]),
                    "TRUE" if r["is_new_vocabulary"] else "FALSE",
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # message analysis (jsonb fields)
    analysis_rows = rows(
        conn,
        """
        SELECT id, message_id, language_distribution, error_count, error_rate, error_types,
               vocabulary_analysis, grammar_structures, confidence_indicators,
               demonstrated_topics, identified_gaps, should_trigger_unit, created_at
        FROM message_analysis
        """,
    )
    for r in analysis_rows:
        if r["message_id"] and str(r["message_id"]) not in message_ids:
            out.append(
                f"-- Skipping message_analysis {r['id']}: message_id {r['message_id']} missing"
            )
            continue
        out.append(
            "INSERT INTO message_analysis "
            "(id, message_id, language_distribution, error_count, error_rate, error_types, "
            " vocabulary_analysis, grammar_structures, confidence_indicators, demonstrated_topics, "
            " identified_gaps, should_trigger_unit, created_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["message_id"]) + "::uuid",
                    sql_jsonb(r["language_distribution"]),
                    sql_int(r["error_count"]) if r["error_count"] is not None else "0",
                    sql_float(r["error_rate"]),
                    sql_jsonb(r["error_types"]),
                    sql_jsonb(r["vocabulary_analysis"]),
                    sql_jsonb(r["grammar_structures"]),
                    sql_jsonb(r["confidence_indicators"]),
                    sql_jsonb(r["demonstrated_topics"]),
                    sql_jsonb(r["identified_gaps"]),
                    "TRUE" if r["should_trigger_unit"] else "FALSE",
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # AI response (jsonb fields)
    ai_rows = rows(
        conn,
        """
        SELECT id, ai_message_id, responding_to_message_id, pedagogical_intent,
               incorporates_topics, corrects_error_implicitly, corrected_error_type,
               introduces_vocabulary, difficulty_level, complexity_score,
               transitioning_to_unit, transition_unit_id, created_at
        FROM ai_response
        """,
    )
    for r in ai_rows:
        if r["ai_message_id"] and str(r["ai_message_id"]) not in message_ids:
            out.append(
                f"-- Skipping ai_response {r['id']}: ai_message_id {r['ai_message_id']} missing"
            )
            continue
        if r["responding_to_message_id"] and str(r["responding_to_message_id"]) not in message_ids:
            out.append(
                f"-- Skipping ai_response {r['id']}: responding_to_message_id {r['responding_to_message_id']} missing"
            )
            continue
        out.append(
            "INSERT INTO ai_response "
            "(id, ai_message_id, responding_to_message_id, pedagogical_intent, incorporates_topics, "
            " corrects_error_implicitly, corrected_error_type, introduces_vocabulary, difficulty_level, "
            " complexity_score, transitioning_to_unit, transition_unit_id, created_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["ai_message_id"]) + "::uuid",
                    (sql_quote(r["responding_to_message_id"]) + "::uuid")
                    if r["responding_to_message_id"]
                    else "NULL",
                    sql_quote(r["pedagogical_intent"]),
                    sql_jsonb(r["incorporates_topics"]),
                    "TRUE" if r["corrects_error_implicitly"] else "FALSE",
                    sql_quote(r["corrected_error_type"]),
                    sql_jsonb(r["introduces_vocabulary"]),
                    sql_quote(r["difficulty_level"]),
                    sql_float(r["complexity_score"]),
                    "TRUE" if r["transitioning_to_unit"] else "FALSE",
                    sql_quote(r["transition_unit_id"]) + "::uuid" if r["transition_unit_id"] else "NULL",
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # student assessment (competency_gaps -> text[])
    assessment_rows = rows(
        conn,
        """
        SELECT id, user_id, language, current_level, target_language_pct, fluency_score,
               error_rate, confidence_level, competency_gaps, assessed_at
        FROM student_assessment
        """,
    )
    for r in assessment_rows:
        if r["user_id"] and str(r["user_id"]) not in user_ids:
            out.append(
                f"-- Skipping student_assessment {r['id']}: user_id {r['user_id']} missing from users"
            )
            continue
        out.append(
            "INSERT INTO student_assessment "
            "(id, user_id, language, current_level, target_language_pct, fluency_score, error_rate, "
            " confidence_level, competency_gaps, assessed_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["user_id"]) + "::uuid",
                    sql_quote(r["language"]),
                    sql_quote(r["current_level"]),
                    sql_float(r["target_language_pct"]) if r["target_language_pct"] is not None else "0",
                    sql_float(r["fluency_score"]) if r["fluency_score"] is not None else "0",
                    sql_float(r["error_rate"]) if r["error_rate"] is not None else "1",
                    sql_quote(r["confidence_level"]),
                    sql_text_array(r["competency_gaps"]),
                    sql_quote(r["assessed_at"]) + "::timestamptz" if r["assessed_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (user_id, language) DO UPDATE SET "
            "current_level = EXCLUDED.current_level, "
            "target_language_pct = EXCLUDED.target_language_pct, "
            "fluency_score = EXCLUDED.fluency_score, "
            "error_rate = EXCLUDED.error_rate, "
            "confidence_level = EXCLUDED.confidence_level, "
            "competency_gaps = EXCLUDED.competency_gaps, "
            "assessed_at = EXCLUDED.assessed_at;"
        )

    # topic hierarchy
    for r in rows(
        conn,
        """
        SELECT id, child_topic_id, parent_topic_id, priority, relationship_reason,
               relationship_type, min_level, can_skip, created_at, updated_at
        FROM topic_hierarchy
        """,
    ):
        out.append(
            "INSERT INTO topic_hierarchy "
            "(id, child_topic_id, parent_topic_id, priority, relationship_reason, relationship_type, "
            " min_level, can_skip, created_at, updated_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["child_topic_id"]),
                    sql_quote(r["parent_topic_id"]),
                    sql_int(r["priority"]) if r["priority"] is not None else "1",
                    sql_quote(r["relationship_reason"]),
                    sql_quote(r["relationship_type"]),
                    sql_quote(r["min_level"]),
                    "TRUE" if r["can_skip"] else "FALSE",
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                    sql_quote(r["updated_at"]) + "::timestamptz" if r["updated_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # units (arrays)
    unit_rows = rows(
        conn,
        """
        SELECT id, topic_id, language, difficulty_level, name, unit_order,
               prerequisite_unit_ids, teaches_topics, created_at, updated_at
        FROM unit
        """,
    )
    unit_ids = {str(r["id"]) for r in unit_rows if r["id"]}
    for r in unit_rows:
        out.append(
            "INSERT INTO unit "
            "(id, topic_id, language, difficulty_level, name, unit_order, prerequisite_unit_ids, "
            " teaches_topics, created_at, updated_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["topic_id"]),
                    sql_quote(r["language"]),
                    sql_quote(r["difficulty_level"]),
                    sql_quote(r["name"]),
                    sql_int(r["unit_order"]) if r["unit_order"] is not None else "0",
                    sql_uuid_array(r["prerequisite_unit_ids"]),
                    sql_text_array(r["teaches_topics"]),
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                    sql_quote(r["updated_at"]) + "::timestamptz" if r["updated_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # levels
    level_rows = rows(
        conn,
        """
        SELECT id, unit_id, type, question_type, content, correct_answer, options, metadata,
               level_order, created_at
        FROM level
        """,
    )
    level_ids = {str(r["id"]) for r in level_rows if r["id"]}
    for r in level_rows:
        if r["unit_id"] and str(r["unit_id"]) not in unit_ids:
            out.append(
                f"-- Skipping level {r['id']}: unit_id {r['unit_id']} missing from unit"
            )
            continue
        out.append(
            "INSERT INTO level "
            "(id, unit_id, type, question_type, content, correct_answer, options, metadata, "
            " level_order, created_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["unit_id"]) + "::uuid",
                    sql_quote(r["type"]),
                    sql_quote(r["question_type"]),
                    sql_quote(r["content"]),
                    sql_quote(r["correct_answer"]),
                    sql_jsonb(r["options"]),
                    sql_jsonb(r["metadata"]),
                    sql_int(r["level_order"]) if r["level_order"] is not None else "0",
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # level progress
    progress_rows = rows(
        conn,
        """
        SELECT id, user_id, level_id, started_at, completed_at, user_answer,
               is_correct, time_spent_seconds, attempt_number, created_at
        FROM level_progress
        """,
    )
    for r in progress_rows:
        if r["user_id"] and str(r["user_id"]) not in user_ids:
            out.append(
                f"-- Skipping level_progress {r['id']}: user_id {r['user_id']} missing from users"
            )
            continue
        if r["level_id"] and str(r["level_id"]) not in level_ids:
            out.append(
                f"-- Skipping level_progress {r['id']}: level_id {r['level_id']} missing from level"
            )
            continue
        out.append(
            "INSERT INTO level_progress "
            "(id, user_id, level_id, started_at, completed_at, user_answer, is_correct, "
            " time_spent_seconds, attempt_number, created_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["user_id"]) + "::uuid",
                    sql_quote(r["level_id"]) + "::uuid",
                    sql_quote(r["started_at"]) + "::timestamptz" if r["started_at"] else "NULL",
                    sql_quote(r["completed_at"]) + "::timestamptz" if r["completed_at"] else "NULL",
                    sql_quote(r["user_answer"]),
                    "NULL" if r["is_correct"] is None else ("TRUE" if r["is_correct"] else "FALSE"),
                    sql_int(r["time_spent_seconds"]),
                    sql_int(r["attempt_number"]) if r["attempt_number"] is not None else "1",
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    # unit assignments
    assignment_rows = rows(
        conn,
        """
        SELECT id, user_id, unit_id, assigned_by, assignment_reason, status, assigned_at,
               started_at, completed_at, unit_score, post_unit_assessment, created_at
        FROM unit_assignment
        """,
    )
    for r in assignment_rows:
        if r["user_id"] and str(r["user_id"]) not in user_ids:
            out.append(
                f"-- Skipping unit_assignment {r['id']}: user_id {r['user_id']} missing from users"
            )
            continue
        if r["unit_id"] and str(r["unit_id"]) not in unit_ids:
            out.append(
                f"-- Skipping unit_assignment {r['id']}: unit_id {r['unit_id']} missing from unit"
            )
            continue
        out.append(
            "INSERT INTO unit_assignment "
            "(id, user_id, unit_id, assigned_by, assignment_reason, status, assigned_at, "
            " started_at, completed_at, unit_score, post_unit_assessment, created_at) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]) + "::uuid",
                    sql_quote(r["user_id"]) + "::uuid",
                    sql_quote(r["unit_id"]) + "::uuid",
                    sql_quote(r["assigned_by"]),
                    sql_quote(r["assignment_reason"]),
                    sql_quote(r["status"]),
                    sql_quote(r["assigned_at"]) + "::timestamptz" if r["assigned_at"] else "NOW()",
                    sql_quote(r["started_at"]) + "::timestamptz" if r["started_at"] else "NULL",
                    sql_quote(r["completed_at"]) + "::timestamptz" if r["completed_at"] else "NULL",
                    sql_float(r["unit_score"]),
                    sql_jsonb(r["post_unit_assessment"]),
                    sql_quote(r["created_at"]) + "::timestamptz" if r["created_at"] else "NOW()",
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    out.append("COMMIT;")
    conn.close()
    return "\n".join(out) + "\n"


def migrate_curriculum(sqlite_path: str, wipe: bool) -> str:
    if not os.path.exists(sqlite_path):
        raise FileNotFoundError(sqlite_path)

    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row

    out: List[str] = []
    out.append("-- Curriculum DB migration from SQLite: " + sqlite_path)
    out.append("BEGIN;")

    if wipe:
        out.append("TRUNCATE question, topic, curriculum_statements CASCADE;")

    for r in rows(
        conn,
        """
        SELECT id, notation, label, description, education_level, authority_status, indexing_status,
               modified_date, rights, rights_holder, language
        FROM curriculum_statements
        """,
    ):
        out.append(
            "INSERT INTO curriculum_statements "
            "(id, notation, label, description, education_level, authority_status, indexing_status, "
            " modified_date, rights, rights_holder, language) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]),
                    sql_quote(r["notation"]),
                    sql_quote(r["label"]),
                    sql_quote(r["description"]),
                    sql_quote(r["education_level"]),
                    sql_quote(r["authority_status"]),
                    sql_quote(r["indexing_status"]),
                    sql_quote(r["modified_date"]),
                    sql_quote(r["rights"]),
                    sql_quote(r["rights_holder"]),
                    sql_quote(r["language"]),
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    for r in rows(
        conn,
        """
        SELECT id, name, curriculumId, parentId, language
        FROM topic
        """,
    ):
        out.append(
            "INSERT INTO topic (id, name, curriculum_id, parent_id, language) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]),
                    sql_quote(r["name"]),
                    sql_quote(r["curriculumId"]),
                    sql_quote(r["parentId"]),
                    sql_quote(r["language"]),
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    for r in rows(
        conn,
        """
        SELECT id, prompt, type, correctAnswer, topicId, curriculumId, teacherId, classId,
               metadata, createdAt, language
        FROM question
        """,
    ):
        out.append(
            "INSERT INTO question "
            "(id, prompt, type, correct_answer, topic_id, curriculum_id, teacher_id, class_id, "
            " metadata, created_at, language) VALUES ("
            + ",".join(
                [
                    sql_quote(r["id"]),
                    sql_quote(r["prompt"]),
                    sql_quote(r["type"]),
                    sql_quote(r["correctAnswer"]),
                    sql_quote(r["topicId"]),
                    sql_quote(r["curriculumId"]),
                    sql_quote(r["teacherId"]),
                    sql_quote(r["classId"]),
                    sql_jsonb(r["metadata"]),
                    sql_quote(r["createdAt"]) + "::timestamptz" if r["createdAt"] else "NOW()",
                    sql_quote(r["language"]),
                ]
            )
            + ") ON CONFLICT (id) DO NOTHING;"
        )

    out.append("COMMIT;")
    conn.close()
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--app-sqlite", default=None, help="Path to legacy app SQLite DB (e.g. api/mvp-dev.db)")
    ap.add_argument(
        "--curriculum-sqlite",
        default=None,
        help="Path to legacy curriculum SQLite DB (e.g. api/languages_curriculum.db)",
    )
    ap.add_argument(
        "--all",
        action="store_true",
        help="Migrate both app + curriculum DBs (uses repo defaults if paths are omitted)",
    )
    ap.add_argument("--wipe", action="store_true", help="TRUNCATE destination tables before importing")
    ap.add_argument("--no-exec", action="store_true", help="Print SQL to stdout instead of running psql")

    args = ap.parse_args()
    if not args.database_url:
        print("Missing --database-url (or DATABASE_URL env var)", file=sys.stderr)
        return 2

    # Decide what to migrate.
    if args.all or (args.app_sqlite is None and args.curriculum_sqlite is None):
        app_path = args.app_sqlite or "api/mvp-dev.db"
        curriculum_path = args.curriculum_sqlite or "api/languages_curriculum.db"
        do_app = True
        do_curriculum = True
    else:
        app_path = args.app_sqlite
        curriculum_path = args.curriculum_sqlite
        do_app = bool(app_path)
        do_curriculum = bool(curriculum_path)
        if not do_app and not do_curriculum:
            print("Nothing to migrate (set --all, --app-sqlite, or --curriculum-sqlite).", file=sys.stderr)
            return 2

    sql_chunks: List[str] = []
    sql_chunks.append("SET client_min_messages TO WARNING;")

    if do_curriculum and curriculum_path:
        sql_chunks.append(migrate_curriculum(curriculum_path, args.wipe))

    if do_app and app_path:
        sql_chunks.append(migrate_app(app_path, args.wipe))

    sql = "\n".join(sql_chunks)

    if args.no_exec:
        sys.stdout.write(sql)
        return 0

    psql_run(args.database_url, sql)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
