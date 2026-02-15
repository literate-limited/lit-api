# Curriculum Topology: DAG-Based Learning Architecture

## Overview

This document describes the hierarchical topic structure and adaptive unit assignment system for language learning (French/Spanish Y7-9).

## Key Insight: DAG (Directed Acyclic Graph)

Topics are NOT organized in a simple tree. Some topics have **multiple parents**, representing multiple valid learning pathways.

### Example: Past Perfect Conditional

```
     Grammar
     /     \
    /       \
Verb Tenses  Conditionals
   |              |
   ↓              ↓
Past Tenses    Simple Conditional
   |              |
   └──→ Past Perfect Conditional ←──┘
        (has TWO parents)
```

**Pedagogical Implication:**
- Student can struggle with "Past Perfect Conditional"
- Could be because they don't understand **past tenses** → assign past tense remedial
- OR because they don't understand **conditionals** → assign conditional remedial
- AI explores both paths, diagnoses the root cause

---

## Data Structure

### TOPIC_HIERARCHY (Junction Table)

Many-to-many relationships between topics (the DAG edges).

```sql
INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('past_perfect_conditional', 'past_tenses', 1, 'prerequisite');

INSERT INTO topic_hierarchy (child_topic_id, parent_topic_id, priority, relationship_type)
VALUES ('past_perfect_conditional', 'conditionals', 1, 'prerequisite');
```

**Key Fields:**
- `child_topic_id` - Topic that depends on parent
- `parent_topic_id` - Prerequisite topic
- `priority` - If multiple parents, which is primary?
- `relationship_type` - 'prerequisite' | 'related' | 'reinforces'

### UNIT (Collection of Levels)

A UNIT is a bounded learning chunk: lesson + questions on a specific topic at a specific difficulty.

```
UNIT "Greetings - Y7 - Easy"
├── LEVEL 1: LESSON (instructional content, "click OK")
├── LEVEL 2: QUESTION MCQ (multiple choice)
├── LEVEL 3: QUESTION FILL (fill-in-blank)
└── LEVEL 4: QUESTION MCQ (reinforcement)
```

**Key Fields:**
- `topic_id` - Which topic does this unit teach?
- `difficulty_level` - Y7 / Y8 / Y9
- `teaches_topics` - Array of topics covered
- `prerequisite_unit_ids` - Must complete these first

### LEVEL (Individual Lesson or Question)

```sql
-- Lesson Level
INSERT INTO level (unit_id, type, content)
VALUES (unit_id_1, 'lesson', '<h2>Greetings in Spanish</h2><p>...');

-- MCQ Level
INSERT INTO level (unit_id, type, question_type, content, correct_answer, options)
VALUES (unit_id_1, 'question', 'mcq', 'How do you greet in Spanish?',
  '1', '["Hola", "Adiós", "Por favor"]'::jsonb);

-- Fill-in-blank Level
INSERT INTO level (unit_id, type, question_type, content, correct_answer)
VALUES (unit_id_1, 'question', 'fill', 'Hello in Spanish is ___',
  'Hola');
```

### STUDENT_ASSESSMENT

Tracks language production metrics from chat analysis.

```sql
INSERT INTO student_assessment
(user_id, language, target_language_pct, error_rate, competency_gaps)
VALUES (student_id_1, 'fr', 0.45, 0.15, '{"past_tense", "formal_address"}');
```

**Key Metrics:**
- `target_language_pct` - How much French (vs English) they use
- `error_rate` - Errors per 100 words
- `competency_gaps` - Topics needing work (identified by AI from chat)

### UNIT_ASSIGNMENT

When AI assigns a unit to a student.

```sql
INSERT INTO unit_assignment (user_id, unit_id, assigned_by, assignment_reason)
VALUES (student_id_1, unit_id_5, 'ai', 'Gap identified: past_tense');
```

---

## Flow: Chat → Assessment → Unit Assignment

### 1. Student joins class
- Creates account
- Goes to home page (chat interface)

### 2. AI leads conversation
Student sees:
```
AI: Comment tu t'appelles?
AI: Tu as quel âge?
AI: Quel numéro vient ensuite? Un, deux, trois...
```

### 3. Assessment triggers
As student responds, `computeNextUnits()` is called continuously:

```javascript
const assessment = analyzeChat(recentMessages)
// {
//   targetLanguagePct: 0.3,
//   errorRate: 0.2,
//   competencyGaps: ['numbers', 'past_tense']
// }

const nextUnits = await computeNextUnits(student.id, 'fr')
// Returns ordered array: [Unit1, Unit2, Unit3, ...]

if (assessmentScore >= THRESHOLD) {
  // Chat UI dissolves → Unit UI appears
  showUnit(nextUnits[0])
}
```

### 4. Student completes unit
1. Reads lesson (clicks "OK")
2. Answers 2-3 questions
3. Returns to chat

### 5. Back in chat
AI observes: "They just learned past tense"
- Incorporates past tense into conversation
- Assesses: "Did they apply the lesson?"
- Updates assessment
- Recommends next unit

**Cycle repeats → teach → quiz → teach → quiz**

---

## computeNextUnits() Algorithm

```javascript
async function computeNextUnits(userId, language) {
  // 1. Get current assessment
  const assessment = getLatestAssessment(userId, language)

  // 2. Identify competency gaps
  const gaps = assessment.competency_gaps
  // Example: ['past_tense', 'formal_address']

  // 3. Find units that teach these gaps
  let units = Unit.findByTopics(gaps)

  // 4. Remove already-completed units
  units = units.filter(u => !user.completedUnits.includes(u.id))

  // 5. Check prerequisites
  // If student lacks prerequisite, add remedial unit
  for (const unit of units) {
    const prereqs = unit.prerequisite_unit_ids
    const hasAllPrereqs = prereqs.every(p => user.completedUnits.includes(p))

    if (!hasAllPrereqs) {
      // Add remedial unit BEFORE this unit
      units = insertPrerequisites(units, unit, prereqs)
    }
  }

  // 6. Topological sort
  // Units with satisfied prerequisites come first
  units = units.sort(pedagogicalComparator)

  return units
}
```

---

## Example Scenario: Student Struggles with Past Tense

### Step 1: Assessment detects gap
```
Error patterns in chat:
- "Je go au marché" (wrong: je suis allé)
- "Hier j'eat du pain" (wrong: j'ai mangé)
→ System: "Student cannot form past tense"
```

### Step 2: computeNextUnits() finds solution
```javascript
const gaps = ['past_tense']
const units = [
  {id: 'unit_7', topic: 'past_simple', difficulty: 'Y7', name: 'Past Simple - Introduction'},
  {id: 'unit_8', topic: 'past_perfect', difficulty: 'Y8', name: 'Past Perfect - Build on past simple'},
  {id: 'unit_9', topic: 'past_perfect_conditional', difficulty: 'Y9', name: 'Past Perfect Conditional'}
]
```

### Step 3: Prerequisites checked
```
unit_8 requires: [unit_7]
unit_9 requires: [unit_7, unit_8]

Student hasn't done unit_7 yet
→ Start with unit_7: "Past Simple - Introduction"
```

### Step 4: Student completes unit
1. Reads lesson about past simple (clicked OK)
2. Answers 3 questions on past simple
3. Returns to chat

### Step 5: AI observes improvement
```
New message: "Hier je suis allé au marché" (CORRECT!)
AI: "Excellent! Now let's talk about what happened when you got there..."
System: "Past tense competency improving"
```

### Step 6: Next recommendation
```
Assessment updated:
- past_tense error rate: 0.2 → 0.08 (improving)
- competency_gaps: ['past_tense'] → remove from gaps

nextUnits() now returns: [unit_8: 'Past Perfect', ...]
```

---

## Migration & Setup

### 1. Create schema
```bash
node migrations/001_create_topic_hierarchy.js
```

### 2. Seed topic hierarchy
```bash
psql -d lit_mvp -f seeds/example_topic_hierarchy.sql
```

### 3. Create units from curriculum DB
```javascript
// In a separate setup script
const topics = curriculumDb.prepare('SELECT * FROM topic WHERE language = "fr"').all()

for (const topic of topics) {
  const unit = await db.prepare(`
    INSERT INTO unit (topic_id, language, difficulty_level, name, teaches_topics)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    topic.id,
    'fr',
    extractDifficulty(topic.name),
    topic.name,
    [topic.id] // Array of topics
  )
}
```

---

## Key Design Decisions

1. **DAG instead of tree** - Allows multiple learning paths, reflects real language structure
2. **TOPIC ≠ UNIT** - Topic is concept, Unit is bounded teaching chunk (lesson + questions)
3. **No arbitrary "skill" table** - Use existing TOPIC hierarchy from curriculum
4. **Prerequisite enforcement** - Student can't skip fundamentals
5. **One-page-per-level** - Each lesson or question is a discrete interaction
6. **Teach → quiz within unit** - Spaced repetition in minimal chunks
7. **AI-assigned progression** - Not fixed curriculum, but adapted to gaps

---

## SQL Queries

### Find all prerequisites of a topic (recursive)
```sql
WITH RECURSIVE prerequisites AS (
  SELECT parent_topic_id FROM topic_hierarchy
  WHERE child_topic_id = 'past_perfect_conditional' AND relationship_type = 'prerequisite'

  UNION ALL

  SELECT th.parent_topic_id FROM topic_hierarchy th
  JOIN prerequisites p ON th.child_topic_id = p.parent_topic_id
  WHERE th.relationship_type = 'prerequisite'
)
SELECT DISTINCT parent_topic_id FROM prerequisites;
```

### Find all descendants (what depends on this topic)
```sql
WITH RECURSIVE descendants AS (
  SELECT child_topic_id FROM topic_hierarchy
  WHERE parent_topic_id = 'past_tenses' AND relationship_type = 'prerequisite'

  UNION ALL

  SELECT th.child_topic_id FROM topic_hierarchy th
  JOIN descendants d ON th.parent_topic_id = d.child_topic_id
  WHERE th.relationship_type = 'prerequisite'
)
SELECT DISTINCT child_topic_id FROM descendants;
```

---

## API Routes (to be implemented)

```
POST /curriculum/units/compute-next
  Input: userId, language
  Output: [Unit1, Unit2, Unit3, ...]

GET /curriculum/units/:unitId
  Output: Unit with all levels

POST /curriculum/levels/:levelId/complete-lesson
  For lesson levels only

POST /curriculum/levels/:levelId/submit-answer
  Input: userAnswer
  Output: {correct: boolean, correctAnswer: string}

POST /curriculum/assessment/update
  Input: {targetLanguagePct, errorRate, competencyGaps, ...}
  Output: updated assessment
```

---

This architecture supports:
- ✅ Adaptive learning (AI diagnoses gaps, assigns units)
- ✅ Prerequisite enforcement (can't skip fundamentals)
- ✅ Multiple learning paths (DAG supports alternative routes)
- ✅ Teach-then-quiz pedagogy (within units)
- ✅ Real-time assessment (chat analysis)
- ✅ Scalable (works for Y7-9, extensible to other languages)
