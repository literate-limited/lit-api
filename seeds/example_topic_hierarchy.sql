-- ============================================
-- EXAMPLE: French Topic Hierarchy (DAG)
-- ============================================
-- This demonstrates how topics can have multiple parents
-- Example: "Perfect Conditional" has TWO parents
--   - Parent 1: Past Tenses (under Verb Tenses)
--   - Parent 2: Conditionals (under Modal Verbs)

-- Clean slate for this example
DELETE FROM topic_hierarchy WHERE parent_topic_id IS NOT NULL;

-- ============================================
-- GRAMMAR (Root)
-- ============================================

-- Grammar → Verb Tenses
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('verb_tenses', 'grammar', 1, 'prerequisite', 'Verbs are fundamental to sentence structure');

-- Verb Tenses → Present Tense
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('present_tense', 'verb_tenses', 1, 'prerequisite');

-- Verb Tenses → Past Tenses
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('past_tenses', 'verb_tenses', 2, 'prerequisite');

-- Past Tenses → Past Simple
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('past_simple', 'past_tenses', 1, 'prerequisite', 'Foundation of past narrative');

-- Past Tenses → Past Perfect
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('past_perfect', 'past_tenses', 2, 'prerequisite', 'Build on past simple understanding');

-- Past Tenses → Past Perfect Conditional (FIRST PARENT)
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('past_perfect_conditional', 'past_tenses', 3, 'prerequisite', 'Requires understanding of past tenses');

-- Verb Tenses → Future Tenses
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('future_tenses', 'verb_tenses', 3, 'prerequisite');

-- ============================================
-- GRAMMAR → CONDITIONALS
-- ============================================

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('conditionals', 'grammar', 2, 'prerequisite', 'Express hypothetical scenarios');

-- Conditionals → Simple Conditionals
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('simple_conditional', 'conditionals', 1, 'prerequisite');

-- Conditionals → Past Perfect Conditional (SECOND PARENT)
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('past_perfect_conditional', 'conditionals', 1, 'prerequisite', 'Requires understanding of conditionals');

-- ============================================
-- GRAMMAR → MODAL VERBS
-- ============================================

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('modal_verbs', 'grammar', 3, 'prerequisite');

-- Modal Verbs → Modality
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('modality', 'modal_verbs', 1, 'prerequisite');

-- Modality → Subjunctive (related to expressing certainty/doubt)
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('subjunctive', 'modality', 1, 'prerequisite', 'Express doubt, possibility, emotion');

-- ============================================
-- COMMUNICATIVE FUNCTIONS
-- ============================================

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('socialising', 'communicative_functions', 1, 'prerequisite');

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('asking_questions', 'communicative_functions', 2, 'prerequisite');

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('giving_opinions', 'communicative_functions', 3, 'prerequisite');

-- ============================================
-- VOCABULARY CLUSTERS
-- ============================================

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('family_vocabulary', 'vocabulary', 1, 'prerequisite');

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('food_vocabulary', 'vocabulary', 2, 'prerequisite');

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('time_expressions', 'vocabulary', 3, 'prerequisite');

-- Telling time requires numbers and time vocabulary
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('telling_time', 'time_expressions', 1, 'prerequisite', 'Requires both time vocabulary and number knowledge');

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type, relationship_reason)
VALUES ('telling_time', 'numbers_vocabulary', 1, 'prerequisite', 'Cannot tell time without number knowledge');

-- ============================================
-- SAMPLE QUERY: Find all ancestors of "past_perfect_conditional"
-- ============================================
-- This shows the DAG structure with multiple paths
-- SELECT DISTINCT parent_topic_id FROM topic_hierarchy
-- WHERE child_topic_id = 'past_perfect_conditional'
-- Result:
--   - past_tenses
--   - conditionals
-- Both are valid parent paths to this topic

-- ============================================
-- SAMPLE QUERY: Find all descendants of "grammar"
-- ============================================
-- This shows what topics require grammar as prerequisite
-- WITH RECURSIVE descendants AS (
--   SELECT parent_topic_id, child_topic_id FROM topic_hierarchy
--   WHERE parent_topic_id = 'grammar'
--   UNION ALL
--   SELECT t.parent_topic_id, t.child_topic_id
--   FROM topic_hierarchy t
--   JOIN descendants d ON t.parent_topic_id = d.child_topic_id
-- )
-- SELECT DISTINCT child_topic_id FROM descendants;
