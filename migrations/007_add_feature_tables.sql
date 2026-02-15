-- Migration: Add feature tables for migrated routes
-- Booking, media, badges, progress, feed, eagle, quantum, etc.

-- Booking tables
CREATE TABLE IF NOT EXISTS availability_rules (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    time_zone TEXT NOT NULL DEFAULT 'UTC',
    weekly JSONB NOT NULL DEFAULT '{}',
    allowed_durations JSONB NOT NULL DEFAULT '[5, 15, 30, 60]',
    slot_minutes INTEGER NOT NULL DEFAULT 5,
    buffer_minutes INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_availability_rules_user_brand ON availability_rules(user_id, brand_id);

CREATE TABLE IF NOT EXISTS availability_overrides (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    date DATE NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('blackout', 'extra')),
    closed BOOLEAN NOT NULL DEFAULT false,
    blocks JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_availability_overrides_user_date ON availability_overrides(user_id, date);

CREATE TABLE IF NOT EXISTS booking_types (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price_in_cents INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'aud',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_types_user_brand ON booking_types(user_id, brand_id);

CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY,
    host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    guest_name TEXT,
    guest_email TEXT,
    booking_type_id UUID REFERENCES booking_types(id),
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'RESCHEDULE_PROPOSED')),
    duration_minutes INTEGER NOT NULL,
    brand_id UUID NOT NULL,
    reschedule JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_host ON bookings(host_user_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_user_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_brand ON bookings(brand_id);

-- Media tables
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY,
    brand_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    s3_key TEXT,
    thumbnail_url TEXT,
    duration_seconds INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_brand ON videos(brand_id);

CREATE TABLE IF NOT EXISTS sounds (
    id UUID PRIMARY KEY,
    brand_id UUID NOT NULL,
    name TEXT NOT NULL,
    sound_url TEXT NOT NULL,
    answer TEXT,
    language TEXT,
    alphabet_type TEXT,
    points INTEGER DEFAULT 0,
    image_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sounds_brand ON sounds(brand_id);
CREATE INDEX IF NOT EXISTS idx_sounds_language ON sounds(language);

CREATE TABLE IF NOT EXISTS images (
    id UUID PRIMARY KEY,
    brand_id UUID NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    s3_key TEXT,
    alt_text TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_images_brand ON images(brand_id);

-- Badge tables
CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY,
    brand_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT,
    category TEXT DEFAULT 'general',
    criteria JSONB DEFAULT '{}',
    points INTEGER DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_badges_brand ON badges(brand_id);
CREATE INDEX IF NOT EXISTS idx_badges_category ON badges(category);

CREATE TABLE IF NOT EXISTS user_badges (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge ON user_badges(badge_id);

-- Progress tracking
CREATE TABLE IF NOT EXISTS student_assessments (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    subject TEXT,
    score DOUBLE PRECISION,
    level TEXT,
    error_rate DOUBLE PRECISION DEFAULT 1,
    fluency_score DOUBLE PRECISION DEFAULT 0,
    details JSONB DEFAULT '{}',
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_student_assessments_user ON student_assessments(user_id);

CREATE TABLE IF NOT EXISTS unit_assignment (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,
    assigned_by TEXT NOT NULL,
    assignment_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    unit_score DOUBLE PRECISION,
    post_unit_assessment JSONB,
    brand_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_assignment_user ON unit_assignment(user_id);
CREATE INDEX IF NOT EXISTS idx_unit_assignment_status ON unit_assignment(user_id, status);

-- Feed tables
CREATE TABLE IF NOT EXISTS feed_posts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    class_id UUID,
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'achievement', 'media')),
    content JSONB NOT NULL DEFAULT '{}',
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'class', 'private')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_posts_user ON feed_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_class ON feed_posts(class_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_brand_created ON feed_posts(brand_id, created_at);

CREATE TABLE IF NOT EXISTS feed_likes (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_likes_post ON feed_likes(post_id);

CREATE TABLE IF NOT EXISTS feed_comments (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(post_id);

-- Eagle (project management) tables
CREATE TABLE IF NOT EXISTS eagle_projects (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'research',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eagle_projects_user ON eagle_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_eagle_projects_brand ON eagle_projects(brand_id);

CREATE TABLE IF NOT EXISTS eagle_documents (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES eagle_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    type TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eagle_documents_project ON eagle_documents(project_id);

-- Quantum tasks
CREATE TABLE IF NOT EXISTS quantum_tasks (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    circuit JSONB NOT NULL,
    shots INTEGER NOT NULL DEFAULT 1024,
    backend TEXT NOT NULL DEFAULT 'simulator',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    result JSONB,
    counts JSONB,
    execution_time INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quantum_tasks_user ON quantum_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_quantum_tasks_status ON quantum_tasks(status);

-- Hearts on Fire scenarios
CREATE TABLE IF NOT EXISTS hearts_on_fire_scenarios (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    name TEXT NOT NULL,
    params JSONB NOT NULL,
    outputs JSONB DEFAULT '{}',
    curves JSONB DEFAULT '{}',
    share_code TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hof_scenarios_user ON hearts_on_fire_scenarios(user_id);
CREATE INDEX IF NOT EXISTS idx_hof_scenarios_share ON hearts_on_fire_scenarios(share_code);

-- Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys JSONB NOT NULL,
    device_info JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- Add missing columns to existing tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS booking_visibility TEXT DEFAULT 'public';
ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_time_zone TEXT DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS invite_code TEXT;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS placement_score INTEGER;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS recommended_level TEXT;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_classes_invite ON classes(invite_code);
CREATE INDEX IF NOT EXISTS idx_classes_archived ON classes(is_archived);
