-- Migration 013: Lawlore (law) tables
-- Creates Australian legal research platform tables for statute law and case law
-- with full-text search support and citation linking

-- ---------------------------------------------------------------------------
-- Ensure brand exists
-- ---------------------------------------------------------------------------
INSERT INTO brands (code, name, origins, data)
VALUES (
  'law',
  'Lawlore',
  '["http://localhost:7777","https://lawlore.art","https://www.lawlore.art"]'::jsonb,
  '{
    "theme": "lawlore",
    "primaryColor": "#1e3a8a",
    "secondaryColor": "#0f766e",
    "description": "Australian legal research and statute law search"
  }'::jsonb
)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Law Sources (jurisdictions and API endpoints)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS law_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('legislation', 'cases')),
  api_endpoint TEXT,
  last_sync TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'success', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, code)
);

CREATE INDEX IF NOT EXISTS idx_law_sources_brand
  ON law_sources(brand_id);

-- Seed initial sources
DO $$
DECLARE
  law_brand_id UUID;
BEGIN
  SELECT id INTO law_brand_id FROM brands WHERE code = 'law';
  IF law_brand_id IS NOT NULL THEN
    INSERT INTO law_sources (brand_id, code, name, jurisdiction, source_type, api_endpoint)
    VALUES
      (law_brand_id, 'cth_acts', 'Commonwealth Acts', 'cth', 'legislation', 'https://legislation.gov.au'),
      (law_brand_id, 'cth_regs', 'Commonwealth Regulations', 'cth', 'legislation', 'https://legislation.gov.au'),
      (law_brand_id, 'hca_cases', 'High Court of Australia', 'hca', 'cases', 'https://austlii.edu.au')
    ON CONFLICT (brand_id, code) DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Law Statutes (legislation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS law_statutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES law_sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  short_title TEXT,
  content TEXT NOT NULL,
  content_tsvector tsvector,
  jurisdiction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'repealed', 'superseded')),
  year INTEGER,
  version_no INTEGER DEFAULT 1,
  effective_date DATE,
  repeal_date DATE,
  url TEXT,
  sections JSONB DEFAULT '[]'::jsonb,
  amendments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_statutes_content_tsvector
  ON law_statutes USING GIN (content_tsvector);
CREATE INDEX IF NOT EXISTS idx_law_statutes_brand_jurisdiction
  ON law_statutes(brand_id, jurisdiction);
CREATE INDEX IF NOT EXISTS idx_law_statutes_brand_year
  ON law_statutes(brand_id, year DESC);
CREATE INDEX IF NOT EXISTS idx_law_statutes_brand_status
  ON law_statutes(brand_id, status);
CREATE INDEX IF NOT EXISTS idx_law_statutes_source_id
  ON law_statutes(source_id);

-- ---------------------------------------------------------------------------
-- Law Cases (court judgments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS law_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES law_sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  citation TEXT NOT NULL,
  citations JSONB DEFAULT '[]'::jsonb,
  content TEXT NOT NULL,
  content_tsvector tsvector,
  court TEXT NOT NULL,
  judges JSONB DEFAULT '[]'::jsonb,
  year INTEGER,
  headnotes TEXT,
  holding TEXT,
  jurisdiction TEXT NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, citation)
);

CREATE INDEX IF NOT EXISTS idx_law_cases_content_tsvector
  ON law_cases USING GIN (content_tsvector);
CREATE INDEX IF NOT EXISTS idx_law_cases_brand_year
  ON law_cases(brand_id, year DESC);
CREATE INDEX IF NOT EXISTS idx_law_cases_brand_court
  ON law_cases(brand_id, court);
CREATE INDEX IF NOT EXISTS idx_law_cases_source_id
  ON law_cases(source_id);

-- ---------------------------------------------------------------------------
-- Law Citations (citation linking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS law_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_statute_id UUID REFERENCES law_statutes(id) ON DELETE CASCADE,
  source_case_id UUID REFERENCES law_cases(id) ON DELETE CASCADE,
  target_statute_id UUID REFERENCES law_statutes(id) ON DELETE CASCADE,
  target_case_id UUID REFERENCES law_cases(id) ON DELETE CASCADE,
  citation_text TEXT,
  citation_type TEXT DEFAULT 'reference' CHECK (citation_type IN ('reference', 'amendment', 'repeal', 'supersede')),
  confidence_score NUMERIC(3, 2) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_citations_source_statute
  ON law_citations(brand_id, source_statute_id);
CREATE INDEX IF NOT EXISTS idx_law_citations_source_case
  ON law_citations(brand_id, source_case_id);
CREATE INDEX IF NOT EXISTS idx_law_citations_target_statute
  ON law_citations(brand_id, target_statute_id);
CREATE INDEX IF NOT EXISTS idx_law_citations_target_case
  ON law_citations(brand_id, target_case_id);

-- ---------------------------------------------------------------------------
-- Law Search History (analytics)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS law_search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  filters JSONB DEFAULT '{}'::jsonb,
  result_count INTEGER DEFAULT 0,
  search_type TEXT DEFAULT 'search' CHECK (search_type IN ('search', 'browse', 'direct')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_search_history_brand_user
  ON law_search_history(brand_id, user_id);
CREATE INDEX IF NOT EXISTS idx_law_search_history_created
  ON law_search_history(brand_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Law Saved Searches (user feature)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS law_saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  filters JSONB DEFAULT '{}'::jsonb,
  result_count INTEGER DEFAULT 0,
  last_run TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_saved_searches_user
  ON law_saved_searches(brand_id, user_id);
CREATE INDEX IF NOT EXISTS idx_law_saved_searches_user_created
  ON law_saved_searches(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Ingestion Log (track data sync jobs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS law_ingestion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES law_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed')),
  documents_processed INTEGER DEFAULT 0,
  documents_created INTEGER DEFAULT 0,
  documents_updated INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_law_ingestion_log_source
  ON law_ingestion_log(source_id, completed_at DESC);

-- ---------------------------------------------------------------------------
-- Update Triggers for tsvector columns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION law_statutes_tsvector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_tsvector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.short_title, '') || ' ' || COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER law_statutes_tsvector_trigger
BEFORE INSERT OR UPDATE ON law_statutes
FOR EACH ROW
EXECUTE FUNCTION law_statutes_tsvector_update();

CREATE OR REPLACE FUNCTION law_cases_tsvector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_tsvector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.citation, '') || ' ' || COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER law_cases_tsvector_trigger
BEFORE INSERT OR UPDATE ON law_cases
FOR EACH ROW
EXECUTE FUNCTION law_cases_tsvector_update();
