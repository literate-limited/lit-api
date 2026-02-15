#!/bin/bash
# Setup Math Placement Test
# Creates questions table and seeds math questions for Math Madness

set -e  # Exit on error

echo "🧮 Setting up Math Madness Placement Test..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable not set"
    echo "   Example: export DATABASE_URL=postgres://user:pass@localhost:5432/dbname"
    exit 1
fi

# Run migration
echo ""
echo "📊 Creating questions table..."
psql "$DATABASE_URL" -f migrations/014_create_questions_table.sql

if [ $? -eq 0 ]; then
    echo "✅ Questions table created successfully"
else
    echo "❌ Failed to create questions table"
    exit 1
fi

# Seed data
echo ""
echo "📝 Seeding math placement questions..."
psql "$DATABASE_URL" -f seeds/math_placement_questions.sql

if [ $? -eq 0 ]; then
    echo "✅ Math questions seeded successfully"
else
    echo "❌ Failed to seed math questions"
    exit 1
fi

# Verify
echo ""
echo "🔍 Verifying..."
QUESTION_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM questions WHERE type = 'math_placement';")
echo "   Total math placement questions: $QUESTION_COUNT"

echo ""
echo "✅ Math Madness Placement Test setup complete!"
echo ""
echo "🚀 Next steps:"
echo "   1. Start API server: cd api && npm start"
echo "   2. Test endpoint: GET /placement/math/test"
echo "   3. Open Math Madness in browser"
