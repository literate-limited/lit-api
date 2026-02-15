-- Migration 008: Chat messenger tables (threads, messages, translations)
-- Goal: Support cross-language messaging with server-side translation caching.

-- Threads (DM + group)
CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'dm' CHECK (kind IN ('dm', 'group')),
  title TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_brand ON chat_threads(brand_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(brand_id, updated_at DESC);

-- Membership (denormalize brand_id for cheap brand-scoped lookups)
CREATE TABLE IF NOT EXISTS chat_thread_members (
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_thread_members_user ON chat_thread_members(user_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_chat_thread_members_thread ON chat_thread_members(thread_id, brand_id);

-- Messages (store original; translations in separate table)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'voice', 'system')),
  original_language TEXT,
  original_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id, created_at);

-- Translation cache (per-message, per-language)
CREATE TABLE IF NOT EXISTS chat_message_translations (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, language_code)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_translations_brand_lang ON chat_message_translations(brand_id, language_code);

