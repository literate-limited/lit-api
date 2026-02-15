# Message Processing System: Complete Implementation

## Overview

The message processing system enables adaptive language learning through intelligent chat analysis. When a student sends a message in the target language (French/Spanish), the system:

1. **Analyzes** the message using Claude API for language tagging, error detection, and vocabulary assessment
2. **Segments** the message into words/phrases with language codes enabling flip-able content
3. **Assesses** the student's language production and identifies competency gaps
4. **Responds** with an AI message that implicitly corrects errors and practices demonstrated topics
5. **Triggers** unit assignments when patterns of errors emerge

## Architecture

### Database Schema

Three new tables support the message pipeline:

#### MESSAGE
Stores raw messages with metadata.
```sql
message
├─ id (UUID)
├─ room_id (FK chat_room)
├─ sender_id (FK user)
├─ sender_role ('student' | 'ai' | 'teacher')
├─ message_type ('text' | 'system' | 'assessment_trigger')
├─ raw_text (the exact input)
├─ target_language ('fr' | 'es')
├─ created_at
└─ message_index (for ordering)
```

#### MESSAGE_SEGMENT
Word/phrase-level breakdown enabling flip-able content.
```sql
message_segment
├─ id (UUID)
├─ message_id (FK message)
├─ segment_index (order within message)
├─ segment_text (the word or phrase)
├─ language_code ('fr' | 'en' | 'es' | 'mixed')
├─ char_start, char_end (position in raw_text for highlighting)
├─ is_error (boolean)
├─ error_type ('vocabulary' | 'grammar' | 'spelling' | 'syntax' | 'conjugation')
├─ correction (what it should be)
├─ error_explanation (pedagogical explanation)
├─ error_confidence (0-1 confidence this is an error)
├─ is_new_vocabulary (learning tracking)
└─ created_at
```

**Example**: Message "Je want aller au cinema" produces:
```
segment_index=0: "Je" (language=fr, is_error=false)
segment_index=1: "want" (language=en, is_error=true, error_type=vocabulary, correction=veux)
segment_index=2: "aller au cinema" (language=fr, is_error=false)
```

#### MESSAGE_ANALYSIS
Aggregated metrics for assessment and unit triggering.
```sql
message_analysis
├─ id (UUID)
├─ message_id (FK message, UNIQUE)
├─ language_distribution (JSON: target_language_pct, l1_pct, mixed_pct, unknown_pct)
├─ error_count (integer)
├─ error_rate (errors per 100 words)
├─ error_types (JSON: {vocabulary: 1, grammar: 0, spelling: 0})
├─ vocabulary_analysis (JSON: unique_words, known_words, new_words, complexity_score)
├─ grammar_structures (JSON array: [present_tense, question_formation])
├─ confidence_indicators (JSON: fluency_score, complexity_level, self_correction_attempts)
├─ demonstrated_topics (JSON array: [greetings, present_tense])
├─ identified_gaps (JSON array: [past_tense, formal_address])
├─ should_trigger_unit (boolean)
├─ trigger_reason (explanation)
└─ created_at
```

#### AI_RESPONSE
Metadata about AI responses for pedagogical tracking.
```sql
ai_response
├─ id (UUID)
├─ ai_message_id (FK message)
├─ responding_to_message_id (FK message)
├─ pedagogical_intent ('confirm' | 'correct_implicitly' | 'extend_vocabulary' | 'practice_structure' | 'introduce_topic' | 'assess' | 'celebrate')
├─ incorporates_topics (JSON array)
├─ corrects_error_implicitly (boolean)
├─ corrected_error_type (VARCHAR)
├─ introduces_vocabulary (JSON array)
├─ difficulty_level (VARCHAR)
├─ complexity_score (REAL)
├─ transitioning_to_unit (boolean)
├─ transition_unit_id (FK unit)
└─ created_at
```

### Service Layer: message.service.js

```javascript
export async function processStudentMessage(roomId, studentId, rawText, targetLanguage)
```

Main orchestration function that runs the complete pipeline:

1. **Store raw message**
   - INSERT into message table with sender_role='student'

2. **Analyze with Claude API**
   - Uses Claude 3.5 Sonnet model
   - Returns segmented analysis with language tags and errors
   - Fallback minimal analysis if Claude fails

3. **Store segments**
   - Word/phrase-level breakdown with language codes
   - Character positions for highlighting in UI

4. **Store analysis**
   - Aggregated metrics (error count, language distribution, gaps)
   - Sets should_trigger_unit flag if pattern detected

5. **Update student assessment**
   - Uses rolling average: `new = (old * 0.7) + (current * 0.3)`
   - Merges competency gaps across messages
   - Updates confidence level

6. **Generate AI response**
   - Claude generates response in target language (80%+)
   - Implicitly corrects errors (uses correct form naturally)
   - Asks follow-up questions
   - May introduce new vocabulary
   - Stores AI message with pedagogical_intent metadata

7. **Check unit assignment trigger**
   - If identified_gaps exist, calls computeNextUnits()
   - Returns next recommended unit if threshold met

### API Routes

#### POST /messages/:roomId
Process a student message through the full pipeline.

**Request Body:**
```json
{
  "studentId": "uuid",
  "content": "Je want aller au cinema",
  "targetLanguage": "fr"
}
```

**Response:**
```json
{
  "success": true,
  "message": {
    "id": "uuid",
    "raw_text": "Je want aller au cinema",
    "segments": [
      {
        "text": "Je",
        "language": "fr",
        "is_error": false
      },
      {
        "text": "want",
        "language": "en",
        "is_error": true,
        "correction": "veux",
        "error_explanation": "want is English; in French: veux"
      },
      {
        "text": "aller au cinema",
        "language": "fr",
        "is_error": false
      }
    ]
  },
  "analysis": {
    "error_count": 1,
    "error_rate": 20.0,
    "identified_gaps": ["present_tense_vouloir"],
    "language_distribution": {
      "target_language_pct": 0.83,
      "l1_pct": 0.17
    }
  },
  "aiResponse": {
    "id": "uuid",
    "text": "Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?"
  },
  "assessment": {
    "should_trigger_unit": false,
    "next_unit": null
  }
}
```

#### GET /messages/:roomId
Get conversation history with segments.

**Query params:**
- `limit` (default: 50) - number of messages

**Response:**
```json
[
  {
    "id": "uuid",
    "sender_role": "student",
    "raw_text": "Je want aller au cinema",
    "created_at": "2024-01-15T10:30:00Z",
    "segments": [...]
  },
  {
    "id": "uuid",
    "sender_role": "ai",
    "raw_text": "Oh, tu veux aller au cinéma?...",
    "created_at": "2024-01-15T10:30:05Z",
    "segments": []
  }
]
```

#### GET /messages/:roomId/:messageId
Get detailed message analysis.

**Response:**
```json
{
  "id": "uuid",
  "sender_role": "student",
  "raw_text": "Je want aller au cinema",
  "segments": [...],
  "analysis": {
    "error_count": 1,
    "error_rate": 20.0,
    "identified_gaps": ["present_tense_vouloir"],
    "language_distribution": {...}
  },
  "ai_response": {
    "id": "uuid",
    "text": "...",
    "pedagogical_intent": "correct_implicitly"
  }
}
```

### Socket.io Integration

The `send_message` event now processes messages through the full pipeline:

```javascript
socket.on('send_message', async ({ roomId, content, targetLanguage = 'fr' }) => {
  // 1. Validate student
  // 2. Process through message pipeline
  // 3. Emit 'student_message' with segments
  // 4. Emit 'ai_message' with response
  // 5. Check and emit 'unit_assignment' if triggered
});
```

**Socket Events Emitted:**
- `student_message` - Processed student message with analysis
- `ai_message` - AI response with pedagogical metadata
- `unit_assignment` - When gap pattern triggers unit

## Data Flow: Complete Example

### Input
```
Student sends: "Je want aller au cinema demain"
Target Language: French (fr)
```

### Step 1: Store Raw Message
```sql
INSERT INTO message (id, room_id, sender_id, sender_role, raw_text, target_language)
VALUES ('msg-123', 'room-xyz', 'student-456', 'student', 'Je want aller au cinema demain', 'fr')
```

### Step 2: Analyze with Claude API
Claude processes the message and returns:
```json
{
  "segments": [
    {"text": "Je", "language_code": "fr", "is_error": false},
    {"text": "want", "language_code": "en", "is_error": true, "error_type": "vocabulary", "correction": "veux"},
    {"text": "aller au cinema demain", "language_code": "fr", "is_error": false}
  ],
  "language_distribution": {"target_language_pct": 0.83, "l1_pct": 0.17},
  "error_count": 1,
  "error_rate": 20.0,
  "identified_gaps": ["present_tense_vouloir"],
  "should_trigger": false
}
```

### Step 3: Store Segments
```sql
INSERT INTO message_segment (message_id, segment_index, segment_text, language_code, is_error, correction, char_start, char_end)
VALUES
  ('msg-123', 0, 'Je', 'fr', false, NULL, 0, 2),
  ('msg-123', 1, 'want', 'en', true, 'veux', 3, 7),
  ('msg-123', 2, 'aller au cinema demain', 'fr', false, NULL, 8, 29)
```

### Step 4: Store Analysis
```sql
INSERT INTO message_analysis (message_id, error_count, error_rate, identified_gaps, language_distribution, should_trigger_unit)
VALUES ('msg-123', 1, 20.0, '["present_tense_vouloir"]', '{"target_language_pct": 0.83, "l1_pct": 0.17}', false)
```

### Step 5: Update Student Assessment
```sql
-- Get previous assessment
SELECT * FROM student_assessment WHERE user_id = 'student-456' AND language = 'fr'

-- Calculate new assessment (rolling average 70% old + 30% current)
new_target_pct = (0.60 * 0.7) + (0.83 * 0.3) = 0.69
new_error_rate = (0.25 * 0.7) + (0.20 * 0.3) = 0.235

-- Update
INSERT INTO student_assessment (user_id, language, target_language_pct, error_rate, competency_gaps)
VALUES ('student-456', 'fr', 0.69, 0.235, '["present_tense_vouloir", ...]')
```

### Step 6: Generate AI Response
Claude generates response:
```
"Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?"
```

Notice: Uses correct "veux" naturally, implicitly correcting student's "want".

### Step 7: Store AI Message and Response Metadata
```sql
INSERT INTO message (id, room_id, sender_id, sender_role, raw_text, target_language)
VALUES ('msg-789', 'room-xyz', 'ai-system', 'ai', "Oh, tu veux aller au cinéma?...", 'fr')

INSERT INTO ai_response (ai_message_id, responding_to_message_id, pedagogical_intent, corrects_error_implicitly)
VALUES ('msg-789', 'msg-123', 'correct_implicitly', true)
```

### Step 8: Check Unit Assignment
```javascript
// Current assessment shows gap: present_tense_vouloir
// Call computeNextUnits(student-456, fr)
// Returns: [Unit: "Present Tense Avoir", ...]
// Unit NOT assigned yet (only 1 error, need pattern)
```

### UI Rendering

Student sees in chat:

**Their message (with flip-able segments):**
```
Me: Je want aller au cinéma demain
    ✓ ▔▔▔▔ ✗ (should be: veux)
    [Click "want" to toggle → shows "veux" or click to see translation]
```

**AI response:**
```
AI: Oh, tu veux aller au cinéma? Bonne idée! Quel film veux-tu voir?
    [Click any word to see L1 translation]
```

## Assessment and Unit Triggering

### Rolling Average Assessment
Each message updates the student profile using weighted average:
- 70% weight to previous assessment
- 30% weight to current message

This smooths out noise while responding to trends.

### Unit Triggering Logic
Units are assigned when patterns emerge:

1. **Message 1:** "Je go au marché" → Gap: past_tense
2. **Message 2:** "Hier j'eat du pain" → Gap: past_tense (continues)
3. **Message 3:** "Il vient demain" → Correct conjugation (improving!)

**System decision:** Pattern confirmed across 2+ messages on same topic → Trigger unit assignment

Prevents premature unit assignment from single errors while responding quickly to persistent gaps.

### Implementation in computeNextUnits()
```javascript
async function computeNextUnits(userId, language) {
  // 1. Get student's current assessment
  const assessment = getLatestAssessment(userId, language)

  // 2. Identify competency gaps (from message analysis)
  const gaps = assessment.competency_gaps

  // 3. Find units teaching these gaps
  let units = findUnitsByTopics(gaps)

  // 4. Remove already-completed units
  units = units.filter(u => !user.completedUnits.includes(u.id))

  // 5. Check prerequisites (don't assign advanced units if foundations missing)
  units = enforcePrerequisites(units, user.completedUnits)

  // 6. Topological sort (prerequisites first)
  units = units.sort(pedagogicalComparator)

  return units
}
```

## Flip-able Content: Client-Side Implementation

The segments enable interactive learning in the UI:

```jsx
// React component example
<MessageSegment segment={segment}>
  {segment.language === 'fr' ? (
    <span className={segment.is_error ? 'error' : ''}>
      {segment.text}
      {segment.is_error && (
        <Tooltip correction={segment.correction}>
          {segment.error_explanation}
        </Tooltip>
      )}
    </span>
  ) : (
    <span className="english">{segment.text}</span>
  )}

  <ClickToFlip
    onFlip={() => toggleLanguage(segment.id)}
    translation={getTranslation(segment.text, segment.language)}
  />
</MessageSegment>
```

**Interactions:**
1. **Hover** - Show translation tooltip
2. **Click** - Toggle display between L1↔L2
3. **Select + Hover** - Show error explanation (if applicable)

## Error Detection Examples

### Vocabulary Error
```
Student: "Je go au marché"
System:
  segment: "go"
  language: "en"
  is_error: true
  error_type: "vocabulary"
  correction: "vais" (or "vais aller")
  explanation: "In French, use 'vais' for movement."
```

### Grammar Error
```
Student: "Ils va au cinéma"
System:
  segment: "va"
  language: "fr"
  is_error: true
  error_type: "grammar"
  correction: "vont"
  explanation: "Subject-verb agreement: 'ils' (3rd person plural) requires 'vont'."
```

### Code-Switching (Mixed L1/L2)
```
Student: "Je want to go to the cinema"
System:
  segment: "want to go to the" → language: "en"
  target_language_pct: 0.17 (only "Je" and "cinema" are French)
  AI response heavily models French, gently encourages more French use
```

## Performance Considerations

### Indexing
- `idx_message_room` - Fast retrieval for chat display
- `idx_message_segment_error` - Fast error detection
- `idx_message_analysis_gaps` - Fast gap lookups for assessment

### Data Volume (Y7-9, ~30 students per class)
- ~900 messages/day (30 students × 30 messages)
- ~5-20 segments per message
- ~10KB per message with segments + analysis
- ~10MB/day storage

### Caching Strategy
- Cache recent conversation (last 50 messages) in Redis
- Update assessment every 20 messages (batch processing)
- Compute nextUnits() on-demand or on interval

### Claude API Costs
- ~30 seconds per message (analysis + response generation)
- Two API calls per student message
- Cost: ~$0.006 per message (using Claude 3.5 Sonnet pricing)

## Deployment

### Migration
The schema is automatically applied on startup via `db.js`:
```javascript
await runMigrations(); // Runs 001_create_topic_hierarchy.js and 002_create_message_schema.js
```

### Environment Variables
```bash
ANTHROPIC_API_KEY=sk-...
```

### Server Setup
```bash
npm install
npm start  # Runs migrations and starts server
```

### Socket.io Namespace
Events are emitted to the room namespace:
- `io.to(roomId).emit('student_message', ...)`
- `io.to(roomId).emit('ai_message', ...)`
- `io.to(roomId).emit('unit_assignment', ...)`

## Testing

### Unit Tests
- Segment parsing from raw text
- Language code detection
- Error classification accuracy
- Assessment rolling average calculation

### Integration Tests
- Full message pipeline end-to-end
- Claude API fallback handling
- Database transaction consistency
- Socket.io event emission

### Load Tests
- Multiple students sending messages simultaneously
- Claude API rate limiting
- Database query performance with large message volumes

## Next Steps

1. **Create message UI component** - React component to display messages with flip-able segments
2. **Implement Socket.io client** - Connect chat UI to message processing backend
3. **Build unit player** - Component to display lessons and questions
4. **Add teacher dashboard** - Monitor student progress and override unit assignments
5. **Analytics** - Track learning outcomes and pedagog ical effectiveness

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Chat UI (React)                          │
├─────────────────────────────────────────────────────────────┤
│ User types message → POST /messages/:roomId or send_message │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │  Message Routes         │
        │  (messages.js)          │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────────────────┐
        │  Message Service Pipeline           │
        │  (message.service.js)                │
        ├────────────┬─────────────────────────┤
        │ 1. Store message                    │
        │ 2. Analyze with Claude API          │
        │ 3. Store segments (word-level)      │
        │ 4. Store analysis (metrics)         │
        │ 5. Update student assessment        │
        │ 6. Generate AI response             │
        │ 7. Check unit trigger               │
        └────┬───────────┬──────────┬─────────┘
             │           │          │
   ┌─────────▼───┐  ┌────▼────┐  ┌─▼──────────────┐
   │ DATABASE    │  │ CLAUDE  │  │ computeNextUnits()
   │ (mvp.db)    │  │   API   │  │ curriculum.service.js
   │             │  │ (sonnet)│  │
   │ • message   │  │         │  │ Returns: [Unit1, Unit2...]
   │ • message_  │  │ • Segment  │
   │   segment   │  │ • Language │
   │ • message_  │  │   tagging  │
   │   analysis  │  │ • Error    │
   │ • ai_       │  │   detection│
   │   response  │  │ • Gaps     │
   │             │  │ • AI resp  │
   └─────────────┘  │         │
                    └─────────┘


┌────────────────────────────────────────────────┐
│      Socket.io → Client                        │
├────────────────────────────────────────────────┤
│ • student_message (with segments)              │
│ • ai_message (with pedagogical intent)         │
│ • unit_assignment (when gaps trigger)          │
│ • message_processed (completion)               │
└────────────────────────────────────────────────┘
```
