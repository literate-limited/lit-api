-- Migration 023: Add missing brand entries
-- Adds deb (Debatica), mat (Math Madness), and signsymposium (Sign Symposium)
-- to the brands table so brandResolver can resolve them.

INSERT INTO brands (code, name, origins, data)
VALUES (
  'deb',
  'Debatica',
  '["http://localhost:5555","https://debatica.art","https://www.debatica.art","https://deb.litsuite.app"]'::jsonb,
  '{
    "theme": "debatica",
    "primaryColor": "#f59e0b",
    "secondaryColor": "#22d3ee",
    "description": "Debate Training Arena"
  }'::jsonb
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO brands (code, name, origins, data)
VALUES (
  'mat',
  'Math Madness',
  '["http://localhost:5174","https://math.litsuite.app","https://mathmadness.app","https://www.mathmadness.app"]'::jsonb,
  '{
    "theme": "mat",
    "primaryColor": "#eab308",
    "secondaryColor": "#f59e0b",
    "description": "Learn Math Through Games"
  }'::jsonb
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO brands (code, name, origins, data)
VALUES (
  'signsymposium',
  'Sign Symposium',
  '["http://localhost:5175","https://signsymposium.litsuite.app"]'::jsonb,
  '{
    "theme": "signsymposium",
    "primaryColor": "#8b5cf6",
    "secondaryColor": "#ec4899",
    "description": "AI-Powered Sign Language Learning"
  }'::jsonb
)
ON CONFLICT (code) DO NOTHING;
