-- Migration 016: pgvector embeddings for semantic search
-- Adds embedding storage capability to law_statutes and law_cases tables
-- Note: pgvector extension is optional; embeddings are stored as TEXT (JSON-serialized)
-- For production with pgvector, embeddings can be converted to vector type for indexed similarity search

-- Add embedding columns to law_statutes
-- Use TEXT to store JSON-serialized embeddings (no indexing to avoid size issues)
ALTER TABLE law_statutes
ADD COLUMN IF NOT EXISTS embedding TEXT;

-- Add metadata for embedding tracking
ALTER TABLE law_statutes
ADD COLUMN IF NOT EXISTS embedding_model TEXT,
ADD COLUMN IF NOT EXISTS embedding_created_at TIMESTAMPTZ;

-- Create index on embedding_created_at for efficient filtering
CREATE INDEX IF NOT EXISTS idx_law_statutes_embedding_created
ON law_statutes(embedding_created_at DESC NULLS LAST);

-- Add embedding columns to law_cases
ALTER TABLE law_cases
ADD COLUMN IF NOT EXISTS embedding TEXT;

-- Add metadata for embedding tracking
ALTER TABLE law_cases
ADD COLUMN IF NOT EXISTS embedding_model TEXT,
ADD COLUMN IF NOT EXISTS embedding_created_at TIMESTAMPTZ;

-- Create index on embedding_created_at for efficient filtering
CREATE INDEX IF NOT EXISTS idx_law_cases_embedding_created
ON law_cases(embedding_created_at DESC NULLS LAST);

-- Create law embeddings metadata table
CREATE TABLE IF NOT EXISTS law_embedding_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('statute', 'case')),
  entity_id UUID NOT NULL,
  model TEXT NOT NULL,
  tokens_used INTEGER,
  cost_usd NUMERIC(10, 6),
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_embedding_metadata_entity
ON law_embedding_metadata(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_law_embedding_metadata_brand
ON law_embedding_metadata(brand_id, embedded_at DESC);
