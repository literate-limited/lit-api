# ACARA Curriculum Framework Integration Guide

## Overview

This document outlines the pattern for mapping educational frameworks (ACARA, CEFR, Common Core, etc.) to the unified learning system. This enables consistent competency tracking, recommendations, and pathways across all teaching apps.

## Current Implementations

### 1. Math Madness (mat)
- **Framework:** ACARA Mathematics Curriculum
- **Indicators:** 17 core indicators (MM.NUM.*, MM.ALG.*, MM.GEO.*, MM.STATS.*)
- **Coverage:** Y7-12 (secondary focus)
- **Structure:** `ls:mm:category:skill`
- **Example:** `ls:mm:alg:linear` - Linear Relationships (Y9-10, apply level)

### 2. Lawlore (law)
- **Framework:** Legal Studies Curriculum
- **Indicators:** 6 core indicators (LAW.CURR.*)
- **Coverage:** L1-L3 (Legal levels)
- **Structure:** `ls:law:category:skill`
- **Example:** `ls:law:criminal` - Criminal Law Foundations (L1-L2, analyze level)

### 3. LIT Language (lit)
- **Framework:** CEFR (Common European Framework of Reference)
- **Indicators:** 3 core indicators (LIT.LANG.*)
- **Coverage:** A1-C2 (language proficiency)
- **Structure:** `ls:lit:category:skill`
- **Example:** `ls:lit:cefr:placement` - CEFR Placement Readiness (A1-C2, analyze level)

### 4. Scythe Science (scythe_science) - NEW
- **Framework:** ACARA F-10 Science Curriculum
- **Indicators:** 47 core indicators across 4 strands
- **Coverage:** F-10 (Foundation to Year 10)
- **Strands:**
  - Physical Sciences (15 indicators)
  - Biological Sciences (15 indicators)
  - Earth & Space Sciences (14 indicators)
  - Science Inquiry & Practices (9 indicators)
- **Structure:** `ls:sci:strand:skill`
- **Example:** `ls:sci:ps:energy-conservation-9-10` - Energy Conservation (9-10, analyze level)

## ID Format Convention

All indicator IDs follow this pattern:
```
ls:[app_prefix]:[category]:[skill_name]
```

Where:
- `ls:` = Learning Spine prefix
- `app_prefix` = Short code (mm=math, law, lit, sci, deb, ttv, mat_special, etc.)
- `category` = Subject/strand category
- `skill_name` = Specific skill or concept

## Framework Mapping Template

To add a new curriculum framework for any app:

### Step 1: Define Framework Metadata
```sql
INSERT INTO learning_spine_indicator
  (id, brand_id, app_code, framework_code, subject_area, indicator_code, title, description, level_band, cognitive_level)
VALUES
  ('ls:app:cat:skill', brand_id, 'app_code', 'framework-version', 'subject', 'EXT_CODE',
   'Human Readable Title', 'Description of what students can do', 'LEVEL_BAND', 'cognitive_level')
```

### Step 2: Parameters Explained
- **id:** Unique identifier in learning spine (format: ls:app:cat:skill)
- **brand_id:** UUID of the brand (referenced from brands table)
- **app_code:** Application code (mat, law, lit, scythe_science, etc.)
- **framework_code:** Framework version (acara-f10-v1, cefr-v1, lit-core-v1)
- **subject_area:** Category (physical-science, law, language, math)
- **indicator_code:** External reference (ACSSU112, MM.ALG.LINEAR, LAW.CURR.CRIMINAL)
- **level_band:** Proficiency level (F-2, 3-4, 5-6, 7-8, 9-10, A1-C2, L1-L3, Y7-8, etc.)
- **cognitive_level:** Bloom's level (recall, apply, analyze, evaluate, create)

### Step 3: Map to Content
```sql
INSERT INTO question_indicator_map (brand_id, question_id, indicator_id, alignment_strength)
INSERT INTO unit_indicator_map (brand_id, unit_id, indicator_id, alignment_strength)
INSERT INTO level_indicator_map (brand_id, level_id, indicator_id, alignment_strength)
```

## Cognitive Levels Reference

Mapped to Bloom's Taxonomy:
- **recall:** Remember - define, duplicate, list, memorize
- **apply:** Apply - demonstrate, implement, interpret, solve, use
- **analyze:** Analyze - differentiate, distinguish, discriminate, examine, compare
- **evaluate:** Evaluate - appraise, argue, defend, judge, select, critique
- **create:** Create - compose, construct, design, develop, formulate, write

## Level Band Conventions

### ACARA Subjects (Math, Science)
- F-2 (Foundation to Year 2)
- 3-4 (Years 3-4)
- 5-6 (Years 5-6)
- 7-8 (Years 7-8)
- 9-10 (Years 9-10)

### Language (CEFR)
- A1 (Beginner)
- A2 (Elementary)
- B1 (Intermediate)
- B2 (Upper Intermediate)
- C1 (Advanced)
- C2 (Mastery)

### Law/Professional
- L1 (Foundation)
- L2 (Intermediate)
- L3 (Advanced)
- Y7-8, Y9-10, Y11-12 (Year levels)

## Adding New Apps - Template

### For Debate (deb - future)
```sql
-- Debate Indicators based on International Public Speaking Standards
INSERT INTO learning_spine_indicator (...) VALUES
  ('ls:deb:arg:construction', ..., 'deb', 'debate-core-v1', 'argumentation', 'DEBATE.ARG.CONSTRUCT',
   'Argument Construction', 'Construct logical and well-supported arguments', '9-10', 'analyze'),
  ('ls:deb:rebuttal:technique', ..., 'deb', 'debate-core-v1', 'argumentation', 'DEBATE.REBUT.TECH',
   'Rebuttal Techniques', 'Identify and counter opposing arguments effectively', '9-10', 'analyze'),
  ...
```

### For TTV (ttv - future)
```sql
-- Television Production based on Media Literacy Standards
INSERT INTO learning_spine_indicator (...) VALUES
  ('ls:ttv:prod:planning', ..., 'ttv', 'media-literacy-v1', 'production', 'MEDIA.PROD.PLAN',
   'Production Planning', 'Plan and design television production sequences', '7-8', 'apply'),
  ('ls:ttv:edit:technique', ..., 'ttv', 'media-literacy-v1', 'editing', 'MEDIA.EDIT.TECH',
   'Editing Techniques', 'Apply professional editing techniques', '9-10', 'analyze'),
  ...
```

### For Gifted Math (mat_special - future)
```sql
-- Enriched Mathematics
INSERT INTO learning_spine_indicator (...) VALUES
  ('ls:mat:advanced:topology', ..., 'mat_special', 'enrichment-v1', 'geometry', 'MATH.TOPOLOGY.INTRO',
   'Topology Introduction', 'Understand fundamental topology concepts', '11-12', 'analyze'),
  ('ls:mat:advanced:proof', ..., 'mat_special', 'enrichment-v1', 'logic', 'MATH.PROOF.TECHNIQUE',
   'Proof Techniques', 'Construct formal mathematical proofs', '11-12', 'evaluate'),
  ...
```

## Benefits of This Framework

### ✅ Competency Gap Detection
- System identifies which ACARA indicators student is struggling with
- Automatically recommends remedial pathways
- Tracks mastery progression across curriculum

### ✅ Cross-App Insights
- Students doing Law + Science = see relationships
- Identify transfer skills (argumentation, analysis, etc.)
- Build holistic learner profiles

### ✅ Teacher Analytics
- Dashboard shows class mastery by curriculum strand
- Identifies which ACARA indicators need more instruction
- Suggests alternative teaching strategies

### ✅ Adaptive Recommendations
- Recommendations based on competency gaps
- Pathways sequenced by curriculum progression
- Difficulty scaling (F-2 → 3-4 → 5-6 → etc.)

### ✅ Curriculum Alignment
- Each question maps to specific indicator
- Assessment results tied to curriculum outcomes
- Evidence for compliance/accreditation

### ✅ Future-Proof Scaling
- Same pattern works for any curriculum
- Can add frameworks without changing core system
- Multi-tenancy ready from day one

## Migration Files

Each app has a dedicated migration:
- `018_lesson_metadata.sql` - Lesson structure
- `019_unit_assessments.sql` - Assessment framework
- `020_learning_spine.sql` - Math, Law, LIT indicators
- `021_learning_pathways.sql` - Pathway engine
- `022_acara_science_indicators.sql` - Science ACARA mapping
- `023_debate_framework.sql` - (NEXT)
- `024_ttv_media_literacy.sql` - (NEXT)
- `025_gifted_math_enrichment.sql` - (NEXT)

## Running the Seed

When you add a new brand:
```sql
INSERT INTO brands (code, name) VALUES ('scythe_science', 'Scythe Science');
```

The migration automatically:
1. Finds the brand by code
2. Creates indicators for that brand
3. Seeds question/unit/level mappings
4. Logs the operation in progress_sync_log

## Query Examples

### Find competency gaps for student
```sql
SELECT DISTINCT i.indicator_code, i.title, i.level_band
FROM learning_spine_indicator i
JOIN question_indicator_map qim ON i.id = qim.indicator_id
JOIN unified_student_progress usp ON (
  usp.score < 70 OR usp.status = 'struggling'
)
WHERE usp.user_id = '...' AND i.app_code = 'scythe_science'
ORDER BY i.level_band;
```

### Get pathway recommendations by indicator gaps
```sql
SELECT DISTINCT p.id, p.title, p.code
FROM learning_pathways p
WHERE p.app_code = 'scythe_science'
  AND p.recommended_for_gaps @> ARRAY['ls:sci:ps:energy-conservation-9-10']
ORDER BY p.pathway_type DESC;
```

### Track mastery across indicators
```sql
SELECT
  i.indicator_code,
  COUNT(DISTINCT q.id) as questions_completed,
  ROUND(AVG(usp.score), 2) as avg_score,
  COUNT(DISTINCT CASE WHEN usp.score >= 70 THEN q.id END) as mastered
FROM learning_spine_indicator i
JOIN question_indicator_map qim ON i.id = qim.indicator_id
JOIN question q ON qim.question_id = q.id
LEFT JOIN unified_student_progress usp ON (q.id = usp.topic_id AND usp.user_id = '...')
WHERE i.app_code = 'scythe_science'
GROUP BY i.indicator_code
ORDER BY avg_score DESC;
```

## Next Steps

1. **Complete Science (DONE)** - 47 ACARA F-10 indicators mapped
2. **Add Debate Framework** - International standards + argument analysis
3. **Add TTV Framework** - Media literacy + production skills
4. **Add Gifted Math** - Enrichment track with advanced concepts
5. **Extend LIT** - Full CEFR A1-C2 mapping for multiple languages
6. **Extend DEB** - Multi-language debate frameworks

## Architecture Benefits

✨ **Single Schema** - All frameworks in one system
✨ **Unified Progress** - All apps use same progress table
✨ **Cross-App Pathways** - Students see relationships across subjects
✨ **Scalable** - Add new curriculum frameworks without code changes
✨ **Multi-Tenant** - Each app isolated, same infrastructure
✨ **Future-Proof** - Ready for additional apps, countries, frameworks

This approach future-proofs the entire platform before launch! 🚀
