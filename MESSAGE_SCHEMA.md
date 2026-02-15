# Message Schema: AI-Led Learning Chat

## Overview

The message schema supports a **pedagogically intelligent chat system** where:
- Every message is analyzed for language use (L1 vs L2)
- Errors are detected and annotated
- Content is **flip-able** (click to toggle word/phrase between L1↔L2)
- Analysis feeds into adaptive unit assignment
- AI responds pedagogically (implicitly corrects, expands vocabulary)

## Core Tables

### MESSAGE
Base message storage with metadata.

```sql
INSERT INTO message (room_id, sender_id, sender_role, raw_text, target_language)
VALUES (room_xyz, student_123, 'student', 'Je want aller au cinema', 'fr');
```

**Key Fields:**
- `sender_role` - 'student' | 'ai' | 'teacher'
- `raw_text` - Exactly what was typed/generated
- `target_language` - 'fr' or 'es' (what they're trying to use)
- `message_index` - For efficient ordering

### MESSAGE_SEGMENT
Word/phrase-level breakdown with language tags. **This enables flip-able content.**

```sql
-- Example segments for "Je want aller au cinema"
INSERT INTO message_segment
(message_id, segment_index, segment_text, language_code, is_error, correction)
VALUES
  (msg_id, 0, 'Je', 'fr', false, NULL),
  (msg_id, 1, 'want', 'en', true, 'veux'),  -- Error!
  (msg_id, 2, 'aller au cinema', 'fr', false, NULL);
```

**UI Implementation (React example):**
```javascript
// Render flip-able segments
segments.map((seg, i) => (
  <Segment
    key={i}
    text={seg.text}
    language={seg.language}
    isError={seg.is_error}
    correction={seg.correction}
    onFlip={() => toggleSegmentLanguage(i)}
  />
))
```

**When user clicks/selects a segment:**
- If English segment: show French translation
- If French segment: show English translation
- If error: show correction with explanation

### MESSAGE_ANALYSIS
High-level metrics extracted from message. Used for student assessment.

```json
{
  "message_id": "uuid-123",
  "language_distribution": {
    "target_language_pct": 0.83,
    "l1_pct": 0.17,
    "mixed_pct": 0,
    "unknown_pct": 0
  },
  "error_count": 1,
  "error_rate": 11.1,  // errors per 100 words
  "error_types": {
    "vocabulary": 1,
    "grammar": 0,
    "spelling": 0
  },
  "vocabulary_analysis": {
    "unique_words": 9,
    "known_words": 8,
    "new_words": 1,
    "complexity_score": 0.65
  },
  "grammar_structures": ["present_tense_avoir", "infinitive"],
  "confidence_indicators": {
    "fluency_score": 0.72,
    "complexity_level": "beginner",
    "self_correction_attempts": 0
  },
  "demonstrated_topics": ["cinema_vocabulary", "present_tense", "infinitive"],
  "identified_gaps": ["present_tense_vouloir"],
  "should_trigger_unit": false
}
```

### AI_RESPONSE
Metadata about AI responses. Tracks pedagogical intent.

```sql
INSERT INTO ai_response
(ai_message_id, responding_to_message_id, pedagogical_intent, incorporates_topics, corrects_error_implicitly)
VALUES
  (ai_msg_789, student_msg_123, 'correct_implicitly', '["present_tense_vouloir", "cinema_vocabulary"]', true);
```

**Pedagogical Intents:**
- `confirm` - Acknowledge and continue
- `correct_implicitly` - Use correct form naturally (not "you're wrong")
- `extend_vocabulary` - Introduce new words
- `practice_structure` - Ask question that practices a structure
- `introduce_topic` - Transition toward a unit topic
- `assess` - Test understanding
- `celebrate` - Praise and encourage

## Data Flow

### Step 1: Student Types Message
```
Input: "Je want aller au cinema demain"
```

### Step 2: Process with Claude API
Claude analyzes and returns:
```javascript
{
  segments: [
    {text: "Je", language_code: "fr", is_error: false},
    {text: "want", language_code: "en", is_error: true,
     error_type: "vocabulary", correction: "veux",
     error_explanation: "want (English). In French: veux (je veux = I want)"},
    {text: "aller au cinema demain", language_code: "fr", is_error: false}
  ],
  language_distribution: {target_language_pct: 0.83, l1_pct: 0.17},
  error_count: 1,
  error_rate: 11.1,
  identified_gaps: ["present_tense_vouloir"],
  should_trigger: false  // Only 1 error, not enough to trigger unit
}
```

### Step 3: Store in Database
- Insert into `message` (raw text)
- Insert into `message_segment` (each word/phrase with tags)
- Insert into `message_analysis` (aggregated metrics)
- Update `student_assessment` with rolling averages

### Step 4: AI Generates Response
Claude generates response in French, implicitly correcting:
```
"Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?"
```

Notice: Uses correct form "veux" naturally (doesn't say "you said 'want', that's wrong").

### Step 5: Store AI Response
- Insert `message` (AI message)
- Insert `ai_response` (metadata: corrected error, pedagogical intent)

### Step 6: Check Unit Trigger
```javascript
if (messageAnalysis.should_trigger_unit) {
  const nextUnit = await checkUnitAssignmentTrigger(studentId, language)
  if (nextUnit) {
    // Chat UI dissolves → Unit UI with lesson + questions
    transitionToUnit(nextUnit)
  }
}
```

## Flip-able Content Rendering

**Student sees message with annotations:**

```
Me: Je want aller au cinéma demain
    ▔  ▔▔▔▔  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
    ✓   ✗ (should be: veux)

[Hover over "want"]: Shows "veux" + explanation
[Click segment]: Toggles display between L1↔L2
```

**AI response (normal display):**
```
AI: Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?
```

Student can click any segment to see translation:
```
[Hover "cinéma"]: Shows English equivalent if needed
```

## Assessment Integration

### Rolling Average Assessment
Each message updates `student_assessment`:

```javascript
// Previous assessment
{target_language_pct: 0.60, error_rate: 0.25}

// Current message
{target_language_pct: 0.83, error_rate: 0.11}

// New assessment (70% old + 30% current)
{target_language_pct: 0.67, error_rate: 0.22}
```

### Unit Triggering Logic
Unit assigned when:
1. **Pattern emerges**: 2+ messages with same gap topic
2. **High error rate**: >20% errors on structured grammar
3. **Assessment threshold met**: `should_trigger_unit = true`

Example:
```
Message 1: "Je want aller" → Gap: present_tense_vouloir
Message 2: "Tu veux..." → Gap: still present_tense_vouloir
Message 3: "Ils veulent..." → Gap: still present_tense_vouloir

System: "Pattern detected. Trigger unit assignment."
computeNextUnits() → ["Unit: Present Tense Avoir/Aller"]
```

## Edge Cases & Nuances

### Code-Switching
Student mixes languages in one message:
```
"Je want go to the cinema"
```

Segments would be:
```
[Je] [want] [go] [to] [the] [cinema]
[fr] [en]   [en] [en] [en]  [en]
```

Result: `target_language_pct: 0.17` (only 1 out of 6 words in French)

AI response: Gently encourages more French, models heavily French response.

### Error Severity
Not all errors trigger units:
- **Typos/Spelling**: Minor (don't trigger)
- **Vocabulary**: Medium (trigger if repeated)
- **Grammar/Conjugation**: Significant (trigger faster)
- **Syntax**: Severe (trigger immediately)

### New Vocabulary
When AI introduces new words:
```javascript
{
  is_new_vocabulary: true,
  demonstrates_topics: ["cinema_vocabulary"],
  vocabulary_analysis: {new_words: 2}
}
```

System notes: "Student encountered: cinéma, film, voir"
Next assessment can check if they remember these words.

## Querying Examples

### Get conversation with all segments (for flip-able rendering)
```javascript
getConversationWithSegments(roomId, limit = 50)
// Returns message with segments array for UI rendering
```

### Get error pattern analysis
```sql
SELECT
  sender_id,
  ARRAY_AGG(DISTINCT error_type) as error_types,
  COUNT(*) as error_count,
  AVG(error_rate) as avg_error_rate
FROM message_analysis
WHERE message_id IN (
  SELECT id FROM message WHERE sender_id = ? AND sender_role = 'student'
)
GROUP BY sender_id;
```

### Get vocabulary growth
```sql
SELECT
  DATE(m.created_at) as date,
  SUM((ma.vocabulary_analysis->>'new_words')::int) as new_words_learned,
  AVG((ma.vocabulary_analysis->>'complexity_score')::float) as avg_complexity
FROM message m
JOIN message_analysis ma ON m.id = ma.message_id
WHERE m.sender_id = ? AND m.sender_role = 'student'
GROUP BY DATE(m.created_at)
ORDER BY date DESC;
```

## Performance Considerations

### Indexing
- `idx_message_room` - Fast retrieval for chat display
- `idx_message_segment_error` - Fast error detection
- `idx_message_analysis_gaps` - Fast gap lookups for assessment

### Data Volume
- Each message might generate 5-20 segments
- Y7-9 classes: ~30 students × 30 messages/day = 900 messages/day
- ~10KB per message (with all segments + analysis)
- ~10MB/day storage

### Caching Strategy
- Cache recent conversation (last 50 messages) in Redis
- Update assessment every 20 messages (batch processing)
- Compute nextUnits() only when needed or on interval

## Summary

**The message schema enables:**
✅ Word-level language tagging (L1 vs L2)
✅ Flip-able segment rendering
✅ Error detection & implicit correction
✅ Pedagogical AI responses
✅ Real-time assessment updates
✅ Adaptive unit assignment

**Student experience:**
1. Chat with AI naturally (mix of L1/L2 ok)
2. See errors highlighted inline
3. Click segments to see translations
4. When gaps emerge → seamless transition to unit
5. Complete lesson + questions
6. Return to chat with new skills
7. Repeat
