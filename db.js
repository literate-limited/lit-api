import { Pool } from "pg";
import dotenv from "dotenv";

// -----------------------------
// Environment loading
// -----------------------------
const env = process.env.NODE_ENV || "development";
if (env === "development") {
  dotenv.config({ path: ".env.development" });
} else {
  // In staging/prod, prefer real environment variables (or a mounted .env)
  dotenv.config();
}

// -----------------------------
// Postgres (primary app DB)
// -----------------------------
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URI;
if (!databaseUrl) {
  throw new Error(
    "Missing DATABASE_URL (or POSTGRES_URI). The MVP is now Postgres-first."
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
  // Allow managed Postgres (Neon/Railway/etc). For local dev you can omit SSL.
  ssl:
    process.env.PGSSL === "true" || String(databaseUrl).includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
});

// Small helper API to keep call sites clean.
const db = {
  pool,
  async query(text, params) {
    return pool.query(text, params);
  },
  async one(text, params) {
    const res = await pool.query(text, params);
    return res.rows[0] || null;
  },
  async many(text, params) {
    const res = await pool.query(text, params);
    return res.rows;
  },
  async tx(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn({
        query: (text, params) => client.query(text, params),
        one: async (text, params) => {
          const res = await client.query(text, params);
          return res.rows[0] || null;
        },
        many: async (text, params) => {
          const res = await client.query(text, params);
          return res.rows;
        },
      });
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
};

// -----------------------------
// Postgres migrations (minimal, idempotent)
// -----------------------------
async function runPgMigrations() {
  // 0) migrations registry
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const has = async (name) => {
    const row = await db.one("SELECT 1 FROM migrations WHERE name = $1", [name]);
    return Boolean(row);
  };

  const mark = (name) =>
    db.query("INSERT INTO migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [
      name,
    ]);

  // 1) core tables
  if (!(await has("001_core_tables"))) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        first_name TEXT NOT NULL,
        middle_name TEXT,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS classes (
        id UUID PRIMARY KEY,
        teacher_id UUID NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        year_level INTEGER,
        class_identifier TEXT,
        subject TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id);
      CREATE INDEX IF NOT EXISTS idx_classes_year_subject ON classes(year_level, subject);

      CREATE TABLE IF NOT EXISTS enrollments (
        id UUID PRIMARY KEY,
        class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(class_id, student_id)
      );

      CREATE INDEX IF NOT EXISTS idx_enrollments_class ON enrollments(class_id);
      CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);

      CREATE TABLE IF NOT EXISTS chat_rooms (
        id UUID PRIMARY KEY,
        class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('class', 'private')),
        ai_context TEXT,
        language_code TEXT,
        assessment_interval INTEGER DEFAULT 20,
        last_assessment_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_rooms_class ON chat_rooms(class_id);
      CREATE INDEX IF NOT EXISTS idx_chat_rooms_student ON chat_rooms(student_id);
    `);

    await mark("001_core_tables");
  }

  // 2) adaptive learning + message schema
  if (!(await has("002_message_schema"))) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS topic_hierarchy (
        id UUID PRIMARY KEY,
        child_topic_id TEXT NOT NULL,
        parent_topic_id TEXT NOT NULL,
        priority INTEGER DEFAULT 1,
        relationship_reason TEXT,
        relationship_type TEXT NOT NULL DEFAULT 'prerequisite'
          CHECK (relationship_type IN ('prerequisite', 'related', 'reinforces')),
        min_level TEXT DEFAULT 'F-2',
        can_skip BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_topic_hierarchy_child ON topic_hierarchy(child_topic_id);
      CREATE INDEX IF NOT EXISTS idx_topic_hierarchy_parent ON topic_hierarchy(parent_topic_id);

      CREATE TABLE IF NOT EXISTS unit (
        id UUID PRIMARY KEY,
        topic_id TEXT NOT NULL,
        language TEXT NOT NULL,
        difficulty_level TEXT NOT NULL,
        name TEXT NOT NULL,
        unit_order INTEGER DEFAULT 0,
        prerequisite_unit_ids UUID[] DEFAULT '{}'::uuid[],
        teaches_topics TEXT[] NOT NULL DEFAULT '{}'::text[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_unit_topic ON unit(topic_id, language);
      CREATE INDEX IF NOT EXISTS idx_unit_difficulty ON unit(difficulty_level);

      CREATE TABLE IF NOT EXISTS level (
        id UUID PRIMARY KEY,
        unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        question_type TEXT,
        content TEXT,
        correct_answer TEXT,
        options JSONB,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        level_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_level_unit ON level(unit_id);
      CREATE INDEX IF NOT EXISTS idx_level_type ON level(type);

      CREATE TABLE IF NOT EXISTS level_progress (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        level_id UUID NOT NULL REFERENCES level(id) ON DELETE CASCADE,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        user_answer TEXT,
        is_correct BOOLEAN,
        time_spent_seconds INTEGER,
        attempt_number INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, level_id, attempt_number)
      );
      CREATE INDEX IF NOT EXISTS idx_level_progress_user ON level_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_level_progress_level ON level_progress(level_id);

      CREATE TABLE IF NOT EXISTS unit_assignment (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
        assigned_by TEXT NOT NULL,
        assignment_reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        unit_score DOUBLE PRECISION,
        post_unit_assessment JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, unit_id)
      );
      CREATE INDEX IF NOT EXISTS idx_unit_assignment_user ON unit_assignment(user_id);
      CREATE INDEX IF NOT EXISTS idx_unit_assignment_status ON unit_assignment(user_id, status);

      CREATE TABLE IF NOT EXISTS student_assessment (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        language TEXT NOT NULL,
        current_level TEXT,
        target_language_pct DOUBLE PRECISION DEFAULT 0,
        fluency_score DOUBLE PRECISION DEFAULT 0,
        error_rate DOUBLE PRECISION DEFAULT 1,
        confidence_level TEXT,
        competency_gaps TEXT[] NOT NULL DEFAULT '{}'::text[],
        assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, language)
      );
      CREATE INDEX IF NOT EXISTS idx_student_assessment_user ON student_assessment(user_id);
      CREATE INDEX IF NOT EXISTS idx_student_assessment_language ON student_assessment(language);

      CREATE TABLE IF NOT EXISTS message (
        id UUID PRIMARY KEY,
        room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_role TEXT NOT NULL CHECK (sender_role IN ('student', 'teacher', 'ai')),
        message_type TEXT NOT NULL DEFAULT 'text',
        raw_text TEXT NOT NULL,
        target_language TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_message_room ON message(room_id);
      CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);

      CREATE TABLE IF NOT EXISTS message_segment (
        id UUID PRIMARY KEY,
        message_id UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        segment_index INTEGER NOT NULL,
        segment_text TEXT NOT NULL,
        language_code TEXT NOT NULL,
        char_start INTEGER,
        char_end INTEGER,
        is_error BOOLEAN NOT NULL DEFAULT FALSE,
        error_type TEXT,
        correction TEXT,
        error_explanation TEXT,
        is_new_vocabulary BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_message_segment_message ON message_segment(message_id);

      CREATE TABLE IF NOT EXISTS message_analysis (
        id UUID PRIMARY KEY,
        message_id UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        language_distribution JSONB,
        error_count INTEGER DEFAULT 0,
        error_rate DOUBLE PRECISION DEFAULT 0,
        error_types JSONB,
        vocabulary_analysis JSONB,
        grammar_structures JSONB,
        confidence_indicators JSONB,
        demonstrated_topics JSONB,
        identified_gaps JSONB,
        should_trigger_unit BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_message_analysis_message ON message_analysis(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_analysis_trigger ON message_analysis(should_trigger_unit);

      CREATE TABLE IF NOT EXISTS ai_response (
        id UUID PRIMARY KEY,
        ai_message_id UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        responding_to_message_id UUID REFERENCES message(id) ON DELETE SET NULL,
        pedagogical_intent TEXT,
        incorporates_topics JSONB,
        corrects_error_implicitly BOOLEAN DEFAULT FALSE,
        corrected_error_type TEXT,
        introduces_vocabulary JSONB,
        difficulty_level TEXT,
        complexity_score DOUBLE PRECISION,
        transitioning_to_unit BOOLEAN DEFAULT FALSE,
        transition_unit_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_response_ai_message ON ai_response(ai_message_id);
      CREATE INDEX IF NOT EXISTS idx_ai_response_responding_to ON ai_response(responding_to_message_id);
      CREATE INDEX IF NOT EXISTS idx_ai_response_intent ON ai_response(pedagogical_intent);
    `);

    await mark("002_message_schema");
  }

  // 3) curriculum (topics + questions)
  if (!(await has("003_curriculum_schema"))) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS curriculum_statements (
        id TEXT PRIMARY KEY,
        notation TEXT UNIQUE,
        label TEXT,
        description TEXT,
        education_level TEXT,
        authority_status TEXT,
        indexing_status TEXT,
        modified_date TEXT,
        rights TEXT,
        rights_holder TEXT,
        language TEXT,
        statement TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_curriculum_language ON curriculum_statements(language);

      CREATE TABLE IF NOT EXISTS topic (
        id TEXT PRIMARY KEY,
        name TEXT,
        curriculum_id TEXT REFERENCES curriculum_statements(id) ON DELETE SET NULL,
        parent_id TEXT REFERENCES topic(id) ON DELETE SET NULL,
        language TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_topic_curriculum_id ON topic(curriculum_id);
      CREATE INDEX IF NOT EXISTS idx_topic_parent_id ON topic(parent_id);
      CREATE INDEX IF NOT EXISTS idx_topic_language ON topic(language);

      CREATE TABLE IF NOT EXISTS question (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        type TEXT NOT NULL,
        correct_answer TEXT,
        topic_id TEXT REFERENCES topic(id) ON DELETE SET NULL,
        curriculum_id TEXT REFERENCES curriculum_statements(id) ON DELETE SET NULL,
        teacher_id TEXT,
        class_id TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        language TEXT NOT NULL DEFAULT 'fr'
      );
      CREATE INDEX IF NOT EXISTS idx_question_type ON question(type);
      CREATE INDEX IF NOT EXISTS idx_question_curriculum_id ON question(curriculum_id);
      CREATE INDEX IF NOT EXISTS idx_question_topic_id ON question(topic_id);
      CREATE INDEX IF NOT EXISTS idx_question_language ON question(language);
    `);

    // Seed minimal curriculum so `/api/curriculum/*` endpoints work out-of-the-box.
    // (This is intentionally tiny; real curriculum can be imported later.)
    await db.query(`
      INSERT INTO curriculum_statements (id, language, statement) VALUES
        ('seed:curriculum:fr', 'fr', 'Starter French curriculum'),
        ('seed:curriculum:es', 'es', 'Starter Spanish curriculum')
      ON CONFLICT DO NOTHING;

      INSERT INTO topic (id, name, parent_id, language, curriculum_id) VALUES
        ('seed:topic:fr:greetings', 'Greetings', NULL, 'fr', 'seed:curriculum:fr'),
        ('seed:topic:fr:present', 'Present Tense', 'seed:topic:fr:greetings', 'fr', 'seed:curriculum:fr'),
        ('seed:topic:es:greetings', 'Saludos', NULL, 'es', 'seed:curriculum:es'),
        ('seed:topic:es:present', 'Presente', 'seed:topic:es:greetings', 'es', 'seed:curriculum:es')
      ON CONFLICT DO NOTHING;

      INSERT INTO question (id, topic_id, language, prompt, type, correct_answer, metadata) VALUES
        ('seed:question:fr:hello', 'seed:topic:fr:greetings', 'fr', 'How do you say \"Hello\" in French?', 'mcq', 'Bonjour', '{\"difficulty\":\"beginner\"}'),
        ('seed:question:fr:evening', 'seed:topic:fr:greetings', 'fr', 'Translate to French: \"Good evening\"', 'fill', 'Bonsoir', '{\"difficulty\":\"beginner\"}'),
        ('seed:question:fr:avoir', 'seed:topic:fr:present', 'fr', 'Conjugate: \"Je (avoir)\"', 'fill', 'ai', '{\"difficulty\":\"beginner\"}'),
        ('seed:question:es:hello', 'seed:topic:es:greetings', 'es', 'How do you say \"Hello\" in Spanish?', 'mcq', 'Hola', '{\"difficulty\":\"beginner\"}'),
        ('seed:question:es:goodbye', 'seed:topic:es:greetings', 'es', 'Translate to Spanish: \"Goodbye\"', 'fill', 'Adios', '{\"difficulty\":\"beginner\"}'),
        ('seed:question:es:ser', 'seed:topic:es:present', 'es', 'Conjugate: \"Yo (ser)\"', 'fill', 'soy', '{\"difficulty\":\"beginner\"}')
      ON CONFLICT DO NOTHING;
    `);

    await mark("003_curriculum_schema");
  }

  // 4) curriculum schema compatibility (older builds used UUID PKs for curriculum tables)
  if (!(await has("004_curriculum_schema_compat"))) {
    // If these tables don't exist (fresh install), 003 already created them correctly.
    const cs = await db.one(`
      SELECT udt_name
      FROM information_schema.columns
      WHERE table_name = 'curriculum_statements' AND column_name = 'id'
    `);

    if (cs?.udt_name === 'uuid') {
      // Drop FKs that block type changes.
      await db.query(`ALTER TABLE question DROP CONSTRAINT IF EXISTS question_topic_id_fkey`);
      await db.query(`ALTER TABLE question DROP CONSTRAINT IF EXISTS question_curriculum_id_fkey`);
      await db.query(`ALTER TABLE topic DROP CONSTRAINT IF EXISTS topic_curriculum_id_fkey`);
      await db.query(`ALTER TABLE topic DROP CONSTRAINT IF EXISTS topic_parent_id_fkey`);

      // Convert IDs to TEXT so we can store URL-like curriculum statement IDs.
      await db.query(`ALTER TABLE curriculum_statements ALTER COLUMN id TYPE TEXT USING id::text`);
      await db.query(`ALTER TABLE topic ALTER COLUMN id TYPE TEXT USING id::text`);
      await db.query(`ALTER TABLE topic ALTER COLUMN parent_id TYPE TEXT USING parent_id::text`);
      await db.query(`ALTER TABLE topic ALTER COLUMN curriculum_id TYPE TEXT USING curriculum_id::text`);
      await db.query(`ALTER TABLE question ALTER COLUMN id TYPE TEXT USING id::text`);
      await db.query(`ALTER TABLE question ALTER COLUMN topic_id TYPE TEXT USING topic_id::text`);

      // Older schema versions didn't have question.curriculum_id; add after type conversion.
    }

    // Add compatibility columns for legacy curriculum imports (safe to run repeatedly).
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS notation TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS label TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS description TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS education_level TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS authority_status TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS indexing_status TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS modified_date TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS rights TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS rights_holder TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS statement TEXT`);
    await db.query(`ALTER TABLE curriculum_statements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

    await db.query(`ALTER TABLE topic ADD COLUMN IF NOT EXISTS curriculum_id TEXT`);
    await db.query(`ALTER TABLE topic ADD COLUMN IF NOT EXISTS parent_id TEXT`);
    await db.query(`ALTER TABLE topic ADD COLUMN IF NOT EXISTS language TEXT`);
    await db.query(`ALTER TABLE topic ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

    await db.query(`ALTER TABLE question ADD COLUMN IF NOT EXISTS correct_answer TEXT`);
    await db.query(`ALTER TABLE question ADD COLUMN IF NOT EXISTS topic_id TEXT`);
    await db.query(`ALTER TABLE question ADD COLUMN IF NOT EXISTS curriculum_id TEXT`);
    await db.query(`ALTER TABLE question ADD COLUMN IF NOT EXISTS teacher_id TEXT`);
    await db.query(`ALTER TABLE question ADD COLUMN IF NOT EXISTS class_id TEXT`);
    await db.query(`ALTER TABLE question ADD COLUMN IF NOT EXISTS metadata JSONB`);
    await db.query(`ALTER TABLE question ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await db.query(`ALTER TABLE question ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'fr'`);

    // Ensure FKs exist (IF NOT EXISTS isn't supported for constraints, so best-effort).
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'topic_curriculum_id_fkey'
        ) THEN
          ALTER TABLE topic
            ADD CONSTRAINT topic_curriculum_id_fkey
            FOREIGN KEY (curriculum_id) REFERENCES curriculum_statements(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'topic_parent_id_fkey'
        ) THEN
          ALTER TABLE topic
            ADD CONSTRAINT topic_parent_id_fkey
            FOREIGN KEY (parent_id) REFERENCES topic(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'question_topic_id_fkey'
        ) THEN
          ALTER TABLE question
            ADD CONSTRAINT question_topic_id_fkey
            FOREIGN KEY (topic_id) REFERENCES topic(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'question_curriculum_id_fkey'
        ) THEN
          ALTER TABLE question
            ADD CONSTRAINT question_curriculum_id_fkey
            FOREIGN KEY (curriculum_id) REFERENCES curriculum_statements(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Indexes
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_notation ON curriculum_statements(notation)`);

    await mark("004_curriculum_schema_compat");
  }

  // 5) Multi-tenancy support
  if (!(await has("005_multi_tenancy"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "005_add_multi_tenancy.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("005_multi_tenancy");
      console.log("✓ Multi-tenancy migration complete");
    } catch (error) {
      console.error("Error running multi-tenancy migration:", error);
      throw error;
    }
  }

  // 5.1) Credits column used by SSO + TTV flows
  // Keep this additive + idempotent so fresh DBs work without manual SQL.
  if (!(await has("005_user_credits"))) {
    try {
      await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 100`);
      await mark("005_user_credits");
      console.log("✓ User credits migration complete");
    } catch (error) {
      console.error("Error running user credits migration:", error);
      throw error;
    }
  }

  // 18) Seamless SSO tables (sessions, auth codes, clients)
  if (!(await has("018_sso_tables"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "018_sso_tables.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("018_sso_tables");
      console.log("✓ SSO tables migration complete");
    } catch (error) {
      if (error?.code === "ENOENT") {
        console.warn("! Missing 018_sso_tables.sql; skipping migration step");
        await mark("018_sso_tables");
      } else {
      console.error("Error running SSO tables migration:", error);
      throw error;
      }
    }
  }

  // 6) TeleprompTV tables
  if (!(await has("006_ttv_tables"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "006_ttv_tables.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("006_ttv_tables");
      console.log("✓ TTV tables migration complete");
    } catch (error) {
      console.error("Error running TTV tables migration:", error);
      throw error;
    }
  }

  // 23) Ensure all configured brands exist in the DB (deb, mat, signsymposium, etc.)
  if (!(await has("023_add_missing_brands"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "023_add_missing_brands.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("023_add_missing_brands");
      console.log("✓ Missing brands migration complete");
    } catch (error) {
      console.error("Error running missing brands migration:", error);
      throw error;
    }
  }

  // 13) Lawlore (legal research)
  if (!(await has("013_lawlore"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "013_lawlore.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("013_lawlore");
      console.log("✓ Lawlore migration complete");
    } catch (error) {
      console.error("Error running lawlore migration:", error);
      throw error;
    }
  }

  // 14) Extend questions for placement tests
  if (!(await has("014_extend_questions"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "014_extend_questions_for_placement.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("014_extend_questions");
      console.log("✓ Extend questions migration complete");
    } catch (error) {
      console.error("Error running extend questions migration:", error);
      throw error;
    }
  }

  // 15) Lawlore Phase 3 Curriculum
  if (!(await has("015_lawlore_curriculum"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "015_lawlore_curriculum.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("015_lawlore_curriculum");
      console.log("✓ Lawlore Phase 3 curriculum migration complete");
    } catch (error) {
      console.error("Error running lawlore curriculum migration:", error);
      throw error;
    }
  }

  // 16) pgvector embeddings for semantic search
  if (!(await has("016_pgvector_embeddings"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "016_pgvector_embeddings.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("016_pgvector_embeddings");
      console.log("✓ pgvector embeddings migration complete");
    } catch (error) {
      console.error("Error running pgvector embeddings migration:", error);
      throw error;
    }
  }

  // 17) Unified student progress system (cross-app learning tracking)
  if (!(await has("017_unified_progress"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "017_unified_progress.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("017_unified_progress");
      console.log("✓ Unified progress system migration complete");
    } catch (error) {
      if (error?.code === "ENOENT") {
        console.warn("! Missing 017_unified_progress.sql; skipping migration step");
        await mark("017_unified_progress");
      } else {
      console.error("Error running unified progress migration:", error);
      throw error;
      }
    }
  }

  // 18) Lesson metadata (objectives, outcomes, difficulty)
  if (!(await has("018_lesson_metadata"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "018_lesson_metadata.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("018_lesson_metadata");
      console.log("✓ Lesson metadata migration complete");
    } catch (error) {
      if (error?.code === "ENOENT") {
        console.warn("! Missing 018_lesson_metadata.sql; skipping migration step");
        await mark("018_lesson_metadata");
      } else {
      console.error("Error running lesson metadata migration:", error);
      throw error;
      }
    }
  }

  // 19) Unit assessments system (pre/formative/post tests)
  if (!(await has("019_unit_assessments"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "019_unit_assessments.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("019_unit_assessments");
      console.log("✓ Unit assessments migration complete");
    } catch (error) {
      if (error?.code === "ENOENT") {
        console.warn("! Missing 019_unit_assessments.sql; skipping migration step");
        await mark("019_unit_assessments");
      } else {
      console.error("Error running unit assessments migration:", error);
      throw error;
      }
    }
  }

  // 20) Learning Spine (global indicator framework across all teaching apps)
  if (!(await has("020_learning_spine"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "020_learning_spine.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("020_learning_spine");
      console.log("✓ Learning Spine migration complete");
    } catch (error) {
      if (error?.code === "ENOENT") {
        console.warn("! Missing 020_learning_spine.sql; skipping migration step");
        await mark("020_learning_spine");
      } else {
      console.error("Error running Learning Spine migration:", error);
      throw error;
      }
    }
  }

  // 21) Learning Pathways (structured learning journeys with multi-step sequences)
  if (!(await has("021_learning_pathways"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "021_learning_pathways.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("021_learning_pathways");
      console.log("✓ Learning Pathways migration complete");
    } catch (error) {
      console.error("Error running Learning Pathways migration:", error);
      throw error;
    }
  }

  // 22) ACARA F-10 Science Indicators (curriculum framework mapping)
  if (!(await has("022_acara_science_indicators"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "022_acara_science_indicators.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("022_acara_science_indicators");
      console.log("✓ ACARA Science Indicators migration complete");
    } catch (error) {
      console.error("Error running ACARA Science Indicators migration:", error);
      throw error;
    }
  }

  // 23) Add missing brands (deb, mat, signsymposium)
  if (!(await has("023_add_missing_brands"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "023_add_missing_brands.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("023_add_missing_brands");
      console.log("✓ Add missing brands migration complete");
    } catch (error) {
      console.error("Error running add missing brands migration:", error);
      throw error;
    }
  }

  // 26) Seed SSO clients
  if (!(await has("026_seed_sso_clients"))) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationPath = path.join(__dirname, "migrations", "026_seed_sso_clients.sql");

    try {
      const migrationSQL = await fs.readFile(migrationPath, "utf8");
      await db.query(migrationSQL);
      await mark("026_seed_sso_clients");
      console.log("✓ SSO clients seeding complete");
    } catch (error) {
      console.error("Error running SSO clients seeding:", error);
      throw error;
    }
  }

  console.log("✓ Postgres migrations complete");
}

await runPgMigrations();

console.log(`Environment: ${env}`);
console.log("Database: Postgres (DATABASE_URL)");
export default db;
