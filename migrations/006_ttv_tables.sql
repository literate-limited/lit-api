-- Migration 006: TeleprompTV Tables
-- This migration creates all TTV-specific database tables

-- ============================================================================
-- 1. teleprompt_scripts - Script metadata and version control
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL CHECK (length(title) >= 1),
  description TEXT,
  script_type VARCHAR(20) NOT NULL DEFAULT 'other' CHECK (script_type IN ('voiceover', 'sync', 'other')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  duration INTEGER,  -- seconds
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  tags JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  raw_script TEXT,
  proposal JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_scripts_brand ON teleprompt_scripts(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_scripts_created_by ON teleprompt_scripts(created_by);
CREATE INDEX IF NOT EXISTS idx_teleprompt_scripts_status ON teleprompt_scripts(status);

-- ============================================================================
-- 2. teleprompt_videos - Video files for teleprompt scripts
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES teleprompt_scripts(id) ON DELETE CASCADE,
  user_id UUID,
  kind VARCHAR(20) DEFAULT 'cut',
  cut_id UUID,
  cut_index INTEGER,
  cut_count INTEGER,
  cut_text TEXT,
  language VARCHAR(10) DEFAULT 'en',
  title VARCHAR(500) NOT NULL,
  duration INTEGER,
  format VARCHAR(20) DEFAULT 'mp4',
  resolution VARCHAR(20) DEFAULT '1080p',
  file_size BIGINT,
  s3_path VARCHAR(1000),
  s3_url TEXT,
  s3_key VARCHAR(500),
  thumbnail_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  transcoding_progress INTEGER DEFAULT 0,
  subtitle_tracks JSONB DEFAULT '[]'::jsonb,
  transcript TEXT,
  duration_seconds INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_videos_brand ON teleprompt_videos(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_videos_script ON teleprompt_videos(script_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_videos_user ON teleprompt_videos(user_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_videos_status ON teleprompt_videos(status);

-- ============================================================================
-- 3. teleprompt_text_cuts - Text-level cuts belonging to a script
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_text_cuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES teleprompt_scripts(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'deleted')),
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_text_cuts_brand ON teleprompt_text_cuts(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_text_cuts_script ON teleprompt_text_cuts(script_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_text_cuts_script_order ON teleprompt_text_cuts(script_id, "order");

-- ============================================================================
-- 4. teleprompt_cut_stacks - Stacks/collections of cuts
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_cut_stacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES teleprompt_scripts(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  cut_ids JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_cut_stacks_brand ON teleprompt_cut_stacks(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_cut_stacks_script ON teleprompt_cut_stacks(script_id);

-- ============================================================================
-- 5. teleprompt_exports - Exported video records
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES teleprompt_videos(id) ON DELETE CASCADE,
  export_type VARCHAR(50) NOT NULL,
  format VARCHAR(20) DEFAULT 'mp4',
  resolution VARCHAR(20),
  file_size BIGINT,
  s3_path VARCHAR(1000),
  s3_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  progress INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_exports_brand ON teleprompt_exports(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_exports_video ON teleprompt_exports(video_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_exports_status ON teleprompt_exports(status);

-- ============================================================================
-- 6. teleprompt_video_publishes - Published video records
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_video_publishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES teleprompt_videos(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  platform_id VARCHAR(255),
  publish_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_video_publishes_brand ON teleprompt_video_publishes(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_video_publishes_video ON teleprompt_video_publishes(video_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_video_publishes_platform ON teleprompt_video_publishes(platform);

-- ============================================================================
-- 7. teleprompt_transcripts - Video transcription records
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES teleprompt_videos(id) ON DELETE CASCADE,
  language VARCHAR(10) DEFAULT 'en',
  full_text TEXT,
  format VARCHAR(20) DEFAULT 'vtt',
  confidence DECIMAL(3,2),
  word_count INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_transcripts_brand ON teleprompt_transcripts(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_transcripts_video ON teleprompt_transcripts(video_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_transcripts_status ON teleprompt_transcripts(status);

-- ============================================================================
-- 8. teleprompt_transcript_chunks - Individual transcript segments
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_transcript_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  transcript_id UUID NOT NULL REFERENCES teleprompt_transcripts(id) ON DELETE CASCADE,
  start_time DECIMAL(10,2) NOT NULL,
  end_time DECIMAL(10,2) NOT NULL,
  text TEXT NOT NULL,
  confidence DECIMAL(3,2),
  speaker_id VARCHAR(50),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_transcript_chunks_brand ON teleprompt_transcript_chunks(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_transcript_chunks_transcript ON teleprompt_transcript_chunks(transcript_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_transcript_chunks_time ON teleprompt_transcript_chunks(start_time, end_time);

-- ============================================================================
-- 9. teleprompt_drafts - Script draft versions
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES teleprompt_scripts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  title VARCHAR(500),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  is_current BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_drafts_brand ON teleprompt_drafts(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_drafts_script ON teleprompt_drafts(script_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_drafts_version ON teleprompt_drafts(script_id, version);

-- ============================================================================
-- 10. teleprompt_analytics - Usage analytics for teleprompt features
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID,
  script_id UUID REFERENCES teleprompt_scripts(id) ON DELETE SET NULL,
  video_id UUID REFERENCES teleprompt_videos(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB DEFAULT '{}'::jsonb,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_analytics_brand ON teleprompt_analytics(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_analytics_user ON teleprompt_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_analytics_event ON teleprompt_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_teleprompt_analytics_created ON teleprompt_analytics(created_at);

-- ============================================================================
-- 11. teleprompt_events - Event log for teleprompt system
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  video_id UUID REFERENCES teleprompt_videos(id) ON DELETE CASCADE,
  script_id UUID REFERENCES teleprompt_scripts(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB DEFAULT '{}'::jsonb,
  severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_events_brand ON teleprompt_events(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_events_video ON teleprompt_events(video_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_events_type ON teleprompt_events(event_type);
CREATE INDEX IF NOT EXISTS idx_teleprompt_events_severity ON teleprompt_events(severity);

-- ============================================================================
-- 12. teleprompt_cuts - Legacy video cuts table
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_cuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  video_id UUID REFERENCES teleprompt_videos(id) ON DELETE CASCADE,
  script_id UUID REFERENCES teleprompt_scripts(id) ON DELETE CASCADE,
  cut_index INTEGER NOT NULL,
  start_time DECIMAL(10,2),
  end_time DECIMAL(10,2),
  text TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_cuts_brand ON teleprompt_cuts(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_cuts_video ON teleprompt_cuts(video_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_cuts_script ON teleprompt_cuts(script_id);

-- ============================================================================
-- 13. teleprompt_publishes - Legacy publish records
-- ============================================================================
CREATE TABLE IF NOT EXISTS teleprompt_publishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES teleprompt_scripts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  published_by UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teleprompt_publishes_brand ON teleprompt_publishes(brand_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_publishes_script ON teleprompt_publishes(script_id);
CREATE INDEX IF NOT EXISTS idx_teleprompt_publishes_version ON teleprompt_publishes(script_id, version);
