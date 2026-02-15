# Database Seeds

Seed data for populating the LIT MVP database with initial data.

## Math Placement Questions

**File:** `math_placement_questions.sql`

### Overview

Comprehensive set of 35+ math questions for the Math Madness placement test covering:

- **Arithmetic** - Basic operations, fractions, percentages
- **Algebra** - Linear equations, quadratics, functions, logarithms
- **Geometry** - Area, Pythagorean theorem, trigonometry
- **Calculus** - Derivatives, integration
- **Statistics** - Probability, sequences

### Difficulty Levels

| Level | Difficulty Score | Topics | Count |
|-------|-----------------|--------|-------|
| Beginner | 10-30 | Basic arithmetic, fractions | 5 |
| Easy | 35-45 | Basic algebra, percentages, order of operations | 6 |
| Medium | 48-60 | Linear equations, exponents, geometry, Pythagorean theorem | 10 |
| Hard | 62-70 | Quadratics, functions, systems, trigonometry | 7 |
| Expert | 72-82 | Calculus, logarithms, complex numbers, vectors | 9 |

### Question Format

Each question includes:
- **prompt**: The question text
- **options**: 4 multiple choice options
- **correct_answer**: Index of correct answer (0-3)
- **explanation**: Why the answer is correct
- **tags**: Topics covered (e.g., ['algebra', 'linear equations'])
- **difficulty_score**: Numeric score (1-100) for precise sorting

### Usage

```bash
# Run migration first
psql $DATABASE_URL -f migrations/014_create_questions_table.sql

# Then seed questions
psql $DATABASE_URL -f seeds/math_placement_questions.sql

# Or use the setup script
./scripts/setup-math-placement.sh
```

### API Endpoints

Once seeded, questions are available via:

```http
GET /placement/math/test
```

Returns 15 random questions sorted by difficulty.

```http
POST /placement/math/submit
{
  "answers": [
    { "questionId": "uuid", "answer": "1" }
  ]
}
```

Returns score and recommended level.

### Adaptive Testing

Questions are ordered by `difficulty_score` for adaptive testing:
1. Start with medium difficulty
2. If correct, increase difficulty
3. If incorrect, decrease difficulty
4. Final score determines placement

### Adding Questions

To add more questions:

```sql
INSERT INTO questions (
    type, subject, prompt, question_format,
    options, correct_answer, explanation,
    difficulty, difficulty_score, points, tags
) VALUES (
    'math_placement',
    'algebra',
    'Solve: 2x + 5 = 13',
    'mcq',
    '["2", "4", "6", "8"]',
    '1',
    'Subtract 5: 2x = 8. Divide by 2: x = 4',
    'easy',
    40,
    15,
    ARRAY['algebra', 'linear equations']
);
```

### Question Tags

Common tags for filtering/analysis:
- **arithmetic**: addition, subtraction, multiplication, division
- **algebra**: equations, functions, polynomials
- **geometry**: shapes, area, volume, angles
- **calculus**: derivatives, integration, limits
- **trigonometry**: sin, cos, tan, special angles
- **statistics**: probability, mean, median, mode
- **fractions**: operations with fractions
- **exponents**: powers, roots, exponential functions
- **logarithms**: log operations, natural log

### Future Enhancements

- [ ] Add images/diagrams for geometry questions
- [ ] Add LaTeX rendering for complex equations
- [ ] Add hint system (progressive hints)
- [ ] Add worked solutions (step-by-step)
- [ ] Add time limits per question
- [ ] Add difficulty calibration based on user performance
