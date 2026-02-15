-- Seed data: Math Madness Placement Test Questions
-- Comprehensive set of math questions covering various topics and difficulty levels
-- Topics: Arithmetic, Algebra, Geometry, Trigonometry, Calculus, Functions

-- Math Madness brand_id
-- 0f313543-f3d6-48a5-91b3-9f7123fc31ad

-- ============================================================================
-- BEGINNER LEVEL (Y7-Y8 / Ages 12-14)
-- ============================================================================

INSERT INTO question (id, brand_id, type, subject, prompt, question_format, options, correct_answer, explanation, difficulty, difficulty_score, points, tags, active, language) VALUES

-- Basic Arithmetic
(
    'math_q_001',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'math',
    'What is 15 + 27?',
    'mcq',
    '["32", "42", "52", "62"]',
    '1',
    '15 + 27 = 42',
    'beginner',
    10,
    10,
    ARRAY['arithmetic', 'addition'],
    true,
    'en'
),

(
    'math_q_002',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'math',
    'What is 8 × 7?',
    'mcq',
    '["54", "56", "58", "60"]',
    '1',
    '8 × 7 = 56',
    'beginner',
    15,
    10,
    ARRAY['arithmetic', 'multiplication'],
    true,
    'en'
),

(
    'math_q_003',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'math',
    'What is 144 ÷ 12?',
    'mcq',
    '["10", "11", "12", "13"]',
    '2',
    '144 ÷ 12 = 12',
    'beginner',
    20,
    10,
    ARRAY['arithmetic', 'division'],
    true,
    'en'
),

-- Fractions
(
    'math_q_004',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'math',
    'What is 1/2 + 1/4?',
    'mcq',
    '["1/2", "2/4", "3/4", "1/6"]',
    '2',
    '1/2 = 2/4, so 2/4 + 1/4 = 3/4',
    'beginner',
    25,
    15,
    ARRAY['fractions', 'addition'],
    true,
    'en'
),

(
    'math_q_005',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'math',
    'Simplify: 6/8',
    'mcq',
    '["3/4", "2/3", "3/5", "1/2"]',
    '0',
    'Both 6 and 8 are divisible by 2: 6/8 = 3/4',
    'beginner',
    30,
    15,
    ARRAY['fractions', 'simplification'],
    true,
    'en'
),

-- ============================================================================
-- EASY LEVEL (Y8-Y9 / Ages 13-15)
-- ============================================================================

-- Basic Algebra
(
    'math_q_006',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Solve for x: x + 5 = 12',
    'mcq',
    '["5", "7", "12", "17"]',
    '1',
    'Subtract 5 from both sides: x = 12 - 5 = 7',
    'easy',
    35,
    15,
    ARRAY['algebra', 'linear equations', 'solving'],
    true,
    'en'
),

(
    'math_q_007',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'What is 3x when x = 4?',
    'mcq',
    '["7", "12", "34", "43"]',
    '1',
    '3 × 4 = 12',
    'easy',
    40,
    15,
    ARRAY['algebra', 'substitution', 'evaluation'],
    true,
    'en'
),

(
    'math_q_008',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Solve: 2x = 18',
    'mcq',
    '["6", "9", "16", "36"]',
    '1',
    'Divide both sides by 2: x = 18/2 = 9',
    'easy',
    42,
    15,
    ARRAY['algebra', 'linear equations'],
    true,
    'en'
),

-- Percentages
(
    'math_q_009',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'math',
    'What is 20% of 50?',
    'mcq',
    '["5", "10", "15", "20"]',
    '1',
    '20% = 0.2, and 0.2 × 50 = 10',
    'easy',
    38,
    15,
    ARRAY['percentages', 'arithmetic'],
    true,
    'en'
),

-- Order of Operations
(
    'math_q_010',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'math',
    'Calculate: 3 + 4 × 2',
    'mcq',
    '["10", "11", "14", "24"]',
    '1',
    'PEMDAS: Multiply first (4 × 2 = 8), then add (3 + 8 = 11)',
    'easy',
    45,
    20,
    ARRAY['arithmetic', 'order of operations', 'PEMDAS'],
    true,
    'en'
),

(
    'math_q_011',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'math',
    'What is (10 - 4) × 2?',
    'mcq',
    '["2", "6", "12", "16"]',
    '2',
    'Parentheses first: (10 - 4) = 6, then multiply: 6 × 2 = 12',
    'easy',
    44,
    20,
    ARRAY['arithmetic', 'order of operations', 'parentheses'],
    true,
    'en'
),

-- ============================================================================
-- MEDIUM LEVEL (Y9-Y10 / Ages 14-16)
-- ============================================================================

-- Linear Equations
(
    'math_q_012',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Solve for x: 3x - 7 = 11',
    'mcq',
    '["4", "6", "8", "10"]',
    '1',
    'Add 7 to both sides: 3x = 18. Divide by 3: x = 6',
    'medium',
    50,
    20,
    ARRAY['algebra', 'linear equations', 'two-step'],
    true,
    'en'
),

(
    'math_q_013',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'What is the slope of the line y = 2x + 3?',
    'mcq',
    '["2", "3", "5", "2/3"]',
    '0',
    'In y = mx + b form, m is the slope. Here m = 2',
    'medium',
    52,
    20,
    ARRAY['algebra', 'linear functions', 'slope', 'graphing'],
    true,
    'en'
),

-- Exponents
(
    'math_q_014',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Simplify: 2³ × 2²',
    'mcq',
    '["2⁵", "2⁶", "4⁵", "8²"]',
    '0',
    'When multiplying same bases, add exponents: 2³⁺² = 2⁵',
    'medium',
    55,
    20,
    ARRAY['algebra', 'exponents', 'rules'],
    true,
    'en'
),

(
    'math_q_015',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'What is (x²)³?',
    'mcq',
    '["x⁵", "x⁶", "x⁸", "x⁹"]',
    '1',
    'Power of a power: multiply exponents: 2 × 3 = 6, so x⁶',
    'medium',
    58,
    20,
    ARRAY['algebra', 'exponents', 'powers'],
    true,
    'en'
),

-- Geometry - Area
(
    'math_q_016',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'geometry',
    'What is the area of a rectangle with length 8 and width 5?',
    'mcq',
    '["13", "26", "40", "80"]',
    '2',
    'Area of rectangle = length × width = 8 × 5 = 40',
    'medium',
    48,
    15,
    ARRAY['geometry', 'area', 'rectangles'],
    true,
    'en'
),

(
    'math_q_017',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'geometry',
    'What is the area of a triangle with base 6 and height 4?',
    'mcq',
    '["10", "12", "18", "24"]',
    '1',
    'Area of triangle = (1/2) × base × height = (1/2) × 6 × 4 = 12',
    'medium',
    53,
    20,
    ARRAY['geometry', 'area', 'triangles'],
    true,
    'en'
),

-- Pythagorean Theorem
(
    'math_q_018',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'geometry',
    'In a right triangle with legs 3 and 4, what is the hypotenuse?',
    'mcq',
    '["5", "6", "7", "25"]',
    '0',
    'Pythagorean theorem: a² + b² = c². So 3² + 4² = 9 + 16 = 25 = 5²',
    'medium',
    60,
    25,
    ARRAY['geometry', 'pythagorean theorem', 'triangles'],
    true,
    'en'
),

-- Probability
(
    'math_q_019',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'statistics',
    'What is the probability of rolling a 6 on a fair die?',
    'mcq',
    '["1/2", "1/3", "1/6", "1/12"]',
    '2',
    'One favorable outcome (6) out of 6 possible outcomes = 1/6',
    'medium',
    54,
    20,
    ARRAY['probability', 'statistics', 'basic probability'],
    true,
    'en'
),

-- Polynomials
(
    'math_q_020',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Expand: (x + 2)(x + 3)',
    'mcq',
    '["x² + 5x + 6", "x² + 6x + 5", "x² + 5x + 5", "x² + 6x + 6"]',
    '0',
    'FOIL: x² + 3x + 2x + 6 = x² + 5x + 6',
    'medium',
    56,
    25,
    ARRAY['algebra', 'polynomials', 'expansion', 'FOIL'],
    true,
    'en'
),

-- ============================================================================
-- HARD LEVEL (Y10-Y11 / Ages 15-17)
-- ============================================================================

-- Quadratic Equations
(
    'math_q_021',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Solve: x² - 5x + 6 = 0',
    'mcq',
    '["x = 1 or x = 6", "x = 2 or x = 3", "x = -2 or x = -3", "x = 0 or x = 5"]',
    '1',
    'Factor: (x - 2)(x - 3) = 0, so x = 2 or x = 3',
    'hard',
    65,
    30,
    ARRAY['algebra', 'quadratic equations', 'factoring'],
    true,
    'en'
),

(
    'math_q_022',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'What is the vertex of y = x² - 4x + 3?',
    'mcq',
    '["(2, -1)", "(2, 1)", "(-2, -1)", "(4, 3)"]',
    '0',
    'Vertex x-coordinate: -b/(2a) = 4/2 = 2. y(2) = 4 - 8 + 3 = -1',
    'hard',
    68,
    30,
    ARRAY['algebra', 'quadratic functions', 'vertex', 'parabolas'],
    true,
    'en'
),

-- Functions
(
    'math_q_023',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'If f(x) = 2x + 3, what is f(5)?',
    'mcq',
    '["8", "10", "13", "15"]',
    '2',
    'Substitute x = 5: f(5) = 2(5) + 3 = 10 + 3 = 13',
    'hard',
    62,
    25,
    ARRAY['algebra', 'functions', 'evaluation'],
    true,
    'en'
),

(
    'math_q_024',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'What is the inverse of f(x) = (x - 3)/2?',
    'mcq',
    '["2x + 3", "2x - 3", "(x + 3)/2", "x/2 + 3"]',
    '0',
    'Swap x and y, solve for y: x = (y-3)/2 → 2x = y-3 → y = 2x+3',
    'hard',
    70,
    30,
    ARRAY['algebra', 'functions', 'inverse functions'],
    true,
    'en'
),

-- Systems of Equations
(
    'math_q_025',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Solve the system: x + y = 5 and x - y = 1',
    'mcq',
    '["x = 2, y = 3", "x = 3, y = 2", "x = 4, y = 1", "x = 1, y = 4"]',
    '1',
    'Add equations: 2x = 6, so x = 3. Then y = 5 - 3 = 2',
    'hard',
    66,
    30,
    ARRAY['algebra', 'systems of equations', 'linear equations'],
    true,
    'en'
),

-- Trigonometry
(
    'math_q_026',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'geometry',
    'What is sin(30°)?',
    'mcq',
    '["1/2", "√2/2", "√3/2", "1"]',
    '0',
    'sin(30°) = 1/2 (special angle)',
    'hard',
    64,
    25,
    ARRAY['trigonometry', 'special angles', 'sine'],
    true,
    'en'
),

(
    'math_q_027',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'geometry',
    'What is cos(60°)?',
    'mcq',
    '["1/2", "√2/2", "√3/2", "1"]',
    '0',
    'cos(60°) = 1/2 (special angle)',
    'hard',
    64,
    25,
    ARRAY['trigonometry', 'special angles', 'cosine'],
    true,
    'en'
),

-- ============================================================================
-- EXPERT LEVEL (Y11-Y12 / Ages 16-18)
-- ============================================================================

-- Advanced Functions
(
    'math_q_028',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'calculus',
    'What is the derivative of f(x) = x²?',
    'mcq',
    '["x", "2x", "x²/2", "2x²"]',
    '1',
    'Power rule: d/dx(xⁿ) = nxⁿ⁻¹, so d/dx(x²) = 2x',
    'expert',
    75,
    35,
    ARRAY['calculus', 'derivatives', 'power rule'],
    true,
    'en'
),

(
    'math_q_029',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'calculus',
    'What is the derivative of f(x) = 3x² + 2x?',
    'mcq',
    '["6x + 2", "3x + 2", "6x", "3x²/2 + x"]',
    '0',
    'Sum rule and power rule: 3(2x) + 2(1) = 6x + 2',
    'expert',
    78,
    35,
    ARRAY['calculus', 'derivatives', 'sum rule'],
    true,
    'en'
),

-- Logarithms
(
    'math_q_030',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Simplify: log₂(8)',
    'mcq',
    '["2", "3", "4", "8"]',
    '1',
    'log₂(8) asks "2 to what power equals 8?". 2³ = 8, so answer is 3',
    'expert',
    72,
    30,
    ARRAY['algebra', 'logarithms', 'exponentials'],
    true,
    'en'
),

(
    'math_q_031',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'Solve: log(x) + log(x+3) = log(10)',
    'mcq',
    '["x = 1", "x = 2", "x = 3", "x = 5"]',
    '1',
    'log(x(x+3)) = log(10), so x² + 3x = 10, x² + 3x - 10 = 0, x = 2',
    'expert',
    80,
    40,
    ARRAY['algebra', 'logarithms', 'equations'],
    true,
    'en'
),

-- Complex Numbers
(
    'math_q_032',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'What is i² where i = √(-1)?',
    'mcq',
    '["-1", "1", "i", "-i"]',
    '0',
    'By definition, i² = -1',
    'expert',
    74,
    30,
    ARRAY['algebra', 'complex numbers', 'imaginary numbers'],
    true,
    'en'
),

-- Calculus - Integration
(
    'math_q_033',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'calculus',
    'What is ∫ 2x dx?',
    'mcq',
    '["x²", "x² + C", "2x²", "x²/2"]',
    '1',
    'Antiderivative of 2x is x², plus constant of integration: x² + C',
    'expert',
    82,
    40,
    ARRAY['calculus', 'integration', 'antiderivatives'],
    true,
    'en'
),

-- Sequences and Series
(
    'math_q_034',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'What is the sum of the first 10 positive integers?',
    'mcq',
    '["45", "50", "55", "60"]',
    '2',
    'Formula: n(n+1)/2 = 10(11)/2 = 55',
    'expert',
    76,
    35,
    ARRAY['algebra', 'sequences', 'series', 'arithmetic'],
    true,
    'en'
),

-- Vectors
(
    'math_q_035',
    '0f313543-f3d6-48a5-91b3-9f7123fc31ad',
    'math_placement',
    'algebra',
    'What is the magnitude of vector (3, 4)?',
    'mcq',
    '["5", "7", "12", "25"]',
    '0',
    'Magnitude = √(3² + 4²) = √(9 + 16) = √25 = 5',
    'expert',
    77,
    35,
    ARRAY['algebra', 'vectors', 'magnitude', 'geometry'],
    true,
    'en'
)

-- No need to update sequence as id is TEXT not serial
ON CONFLICT (id) DO NOTHING;
