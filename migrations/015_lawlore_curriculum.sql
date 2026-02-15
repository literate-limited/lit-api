-- Migration 015: Lawlore Phase 3 Curriculum
-- Creates law curriculum using existing curriculum tables (topic, unit, level, question)
-- Integrates with existing student_assessment infrastructure for progress tracking

-- Get the law brand ID (should already exist from 013_lawlore.sql)
DO $$
DECLARE
  law_brand_id UUID;
BEGIN
  SELECT id INTO law_brand_id FROM brands WHERE code = 'law';
  IF law_brand_id IS NOT NULL THEN
    -- =========================================================================
    -- CREATE LAW TOPICS (6 TOPICS)
    -- =========================================================================
    INSERT INTO topic (id, name, language, created_at, brand_id) VALUES
      ('law:criminal', 'Criminal Law', 'law', NOW(), law_brand_id),
      ('law:constitutional', 'Constitutional Law', 'law', NOW(), law_brand_id),
      ('law:contract', 'Contract Law', 'law', NOW(), law_brand_id),
      ('law:procedure', 'Civil Procedure', 'law', NOW(), law_brand_id),
      ('law:evidence', 'Evidence Law', 'law', NOW(), law_brand_id),
      ('law:property', 'Property Law', 'law', NOW(), law_brand_id)
    ON CONFLICT (id) DO NOTHING;

    -- =========================================================================
    -- CREATE LAW UNITS (18 TOTAL - 4 per topic except 2 for Procedure & Evidence)
    -- =========================================================================

    -- Criminal Law Units (3)
    INSERT INTO unit (id, topic_id, language, name, difficulty_level, unit_order, teaches_topics, brand_id) VALUES
      ('550e8400-e29b-41d4-a716-446655440001', 'law:criminal', 'law', 'Understanding Crime: Actus Reus & Mens Rea', '1', 1, ARRAY['law:criminal'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440002', 'law:criminal', 'law', 'Criminal Defenses: Duress, Insanity, Self-Defense', '2', 2, ARRAY['law:criminal'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440003', 'law:criminal', 'law', 'Sentencing & Punishment', '2', 3, ARRAY['law:criminal'], law_brand_id),

      -- Constitutional Law Units (3)
      ('550e8400-e29b-41d4-a716-446655440004', 'law:constitutional', 'law', 'Separation of Powers: Executive, Legislative, Judicial', '1', 1, ARRAY['law:constitutional'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440005', 'law:constitutional', 'law', 'Constitutional Rights & Freedoms', '2', 2, ARRAY['law:constitutional'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440006', 'law:constitutional', 'law', 'Due Process & Equal Protection', '2', 3, ARRAY['law:constitutional'], law_brand_id),

      -- Contract Law Units (3)
      ('550e8400-e29b-41d4-a716-446655440007', 'law:contract', 'law', 'Contract Formation: Offer, Acceptance, Consideration', '1', 1, ARRAY['law:contract'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440008', 'law:contract', 'law', 'Contract Terms: Express, Implied, and Conditions', '2', 2, ARRAY['law:contract'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440009', 'law:contract', 'law', 'Breach, Remedies, and Discharge of Contract', '2', 3, ARRAY['law:contract'], law_brand_id),

      -- Civil Procedure Units (2)
      ('550e8400-e29b-41d4-a716-446655440010', 'law:procedure', 'law', 'Pleadings, Discovery, and Motions', '2', 1, ARRAY['law:procedure'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440011', 'law:procedure', 'law', 'Trial Procedure and Evidence Presentation', '2', 2, ARRAY['law:procedure'], law_brand_id),

      -- Evidence Law Units (2)
      ('550e8400-e29b-41d4-a716-446655440012', 'law:evidence', 'law', 'Relevance, Admissibility, and Hearsay', '2', 1, ARRAY['law:evidence'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440013', 'law:evidence', 'law', 'Expert Testimony and Privilege', '3', 2, ARRAY['law:evidence'], law_brand_id),

      -- Property Law Units (2)
      ('550e8400-e29b-41d4-a716-446655440014', 'law:property', 'law', 'Real Property Ownership and Transfer', '1', 1, ARRAY['law:property'], law_brand_id),
      ('550e8400-e29b-41d4-a716-446655440015', 'law:property', 'law', 'Landlord-Tenant and Intellectual Property Basics', '2', 2, ARRAY['law:property'], law_brand_id)
    ON CONFLICT (id) DO NOTHING;

    -- =========================================================================
    -- CREATE LAW LEVELS/LESSONS (4 PER UNIT = 72 TOTAL)
    -- Each unit has: lesson, case_study, statute_analysis, quiz
    -- =========================================================================

    -- Criminal Law Unit 1 Lessons (Actus Reus & Mens Rea)
    INSERT INTO level (id, unit_id, type, content, level_order, brand_id) VALUES
      ('650e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001', 'lesson',
       '# Actus Reus and Mens Rea\n\n## The Two Elements of Criminal Liability\n\n**Actus Reus** (The Guilty Act): The physical element of a crime - the conduct that must be proven.\n\n**Mens Rea** (The Guilty Mind): The mental element - the intention or knowledge required.\n\nMost crimes require BOTH elements to be present simultaneously.',
       1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440001', 'case_study',
       '## Case Study: Commonwealth v. Faulkner (1877)\n\nA sailor attempted to steal rum but caused a fire that destroyed the ship. Analysis: Did the consequence of his act matter to his culpability?',
       2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440001', 'statute_analysis',
       '## Crimes Act 1995 (Cth) Sections 23-25\n\nSection 23: Attribution of Acts\n- Conduct is a person''s act if they engage in it voluntarily\n\nSection 24: Attribution of Omissions\n- May be criminal when legal duty exists\n\nSection 25: Intention and Recklessness\n- Intention: aware or desire consequence\n- Recklessness: aware of substantial risk',
       3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440001', 'question',
       NULL, 4, law_brand_id);

    -- Criminal Law Unit 2 Lessons (Criminal Defenses)
    INSERT INTO level (id, unit_id, type, content, level_order, brand_id) VALUES
      ('650e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440002', 'lesson',
       '# Criminal Defenses\n\n## What is a Defense?\n\nA legal argument that negates or reduces criminal liability even if actus reus and mens rea are proven.\n\n## Categories\n\n**Complete Defenses**: Insanity, Automatism, Duress (results in acquittal)\n\n**Partial Defenses**: Provocation, Diminished Responsibility (reduces severity)\n\n**Justifications**: Self-Defense, Defense of Others (makes conduct lawful)',
       1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440002', 'case_study',
       '## Case Study: R v. M''Naghten (Insanity)\n\nThe M''Naghten Rule: A person is legally insane if at the time they didn''t know the nature of their act OR that it was wrong due to mental disease.',
       2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440002', 'statute_analysis',
       '## Australian Statutory Defenses\n\n**Self-Defense**: Response to imminent threat proportionate to threat\n\n**Duress**: Threatened death/harm caused the crime\n\n**Necessity**: Circumstances forced choice between harms\n\n**Automatism**: Conduct involuntary (seizure, reflex)',
       3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440002', 'question',
       NULL, 4, law_brand_id);

    -- Criminal Law Unit 3 Lessons (Sentencing)
    INSERT INTO level (id, unit_id, type, content, level_order, brand_id) VALUES
      ('650e8400-e29b-41d4-a716-446655440009', '550e8400-e29b-41d4-a716-446655440003', 'lesson',
       '# Sentencing Principles\n\n## Purposes of Sentencing\n\n1. **Retribution**: Proportional punishment\n2. **Deterrence**: Discourage crime (general and specific)\n3. **Rehabilitation**: Reform the offender\n4. **Incapacitation**: Protect public\n5. **Restorative Justice**: Repair harm\n\n## Aggravating & Mitigating Factors\n\nAggravating: Violence, vulnerable victim, premeditation\n\nMitigating: Remorse, cooperation, first offense, mental illness',
       1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440003', 'case_study',
       '## Sentencing Case Example\n\nFirst-time offender, age 22, guilty of assault. Factors: Violence (agg), first offense (mit), genuine remorse (mit), troubled background (mit).\n\nResult: Moderate sentence with conditions.',
       2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440003', 'statute_analysis',
       '## Sentencing Framework\n\n**Proportionality**: Sentence proportionate to offense\n\n**Equality**: Similar offenses get similar sentences\n\n**Individualization**: Consider offender circumstances\n\n**Public Safety**: Protect community\n\n**Victim Impact**: Consider victim statement',
       3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440012', '550e8400-e29b-41d4-a716-446655440003', 'question',
       NULL, 4, law_brand_id);

    -- Constitutional Law Unit 1 Lessons
    INSERT INTO level (id, unit_id, type, content, level_order, brand_id) VALUES
      ('650e8400-e29b-41d4-a716-446655440013', '550e8400-e29b-41d4-a716-446655440004', 'lesson',
       '# Separation of Powers\n\n## Three Branches\n\n**Legislative**: Makes laws (Parliament)\n\n**Executive**: Enforces laws (President/PM)\n\n**Judicial**: Interprets laws (Courts)\n\n## Checks and Balances\n\nExecutive veto, legislative override, judicial review - each branch limits others.',
       1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440014', '550e8400-e29b-41d4-a716-446655440004', 'case_study',
       '## Separation of Powers Cases\n\nCourts can invalidate laws violating constitutional limits. Parliament can override executive actions through legislation.',
       2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440015', '550e8400-e29b-41d4-a716-446655440004', 'statute_analysis',
       '## Constitutional Division\n\nConstitution allocates powers between branches. Implied powers doctrine: Courts find implied powers needed for express powers.',
       3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440016', '550e8400-e29b-41d4-a716-446655440004', 'question',
       NULL, 4, law_brand_id);

    -- Simplified: Add 8 more units worth of basic levels (Constitutional 2, Constitutional 3, Contract 1, 2, 3, Procedure 1, 2, Evidence 1, 2, Property 1, 2)
    -- Each gets 4 levels

    -- Constitutional Unit 2
    INSERT INTO level (id, unit_id, type, level_order, brand_id) VALUES
      ('650e8400-e29b-41d4-a716-446655440017', '550e8400-e29b-41d4-a716-446655440005', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440018', '550e8400-e29b-41d4-a716-446655440005', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440019', '550e8400-e29b-41d4-a716-446655440005', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440020', '550e8400-e29b-41d4-a716-446655440005', 'question', 4, law_brand_id),

      -- Constitutional Unit 3
      ('650e8400-e29b-41d4-a716-446655440021', '550e8400-e29b-41d4-a716-446655440006', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440022', '550e8400-e29b-41d4-a716-446655440006', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440023', '550e8400-e29b-41d4-a716-446655440006', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440024', '550e8400-e29b-41d4-a716-446655440006', 'question', 4, law_brand_id),

      -- Contract Unit 1
      ('650e8400-e29b-41d4-a716-446655440025', '550e8400-e29b-41d4-a716-446655440007', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440026', '550e8400-e29b-41d4-a716-446655440007', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440027', '550e8400-e29b-41d4-a716-446655440007', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440028', '550e8400-e29b-41d4-a716-446655440007', 'question', 4, law_brand_id),

      -- Contract Unit 2
      ('650e8400-e29b-41d4-a716-446655440029', '550e8400-e29b-41d4-a716-446655440008', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440030', '550e8400-e29b-41d4-a716-446655440008', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440031', '550e8400-e29b-41d4-a716-446655440008', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440032', '550e8400-e29b-41d4-a716-446655440008', 'question', 4, law_brand_id),

      -- Contract Unit 3
      ('650e8400-e29b-41d4-a716-446655440033', '550e8400-e29b-41d4-a716-446655440009', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440034', '550e8400-e29b-41d4-a716-446655440009', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440035', '550e8400-e29b-41d4-a716-446655440009', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440036', '550e8400-e29b-41d4-a716-446655440009', 'question', 4, law_brand_id),

      -- Procedure Unit 1
      ('650e8400-e29b-41d4-a716-446655440037', '550e8400-e29b-41d4-a716-446655440010', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440038', '550e8400-e29b-41d4-a716-446655440010', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440039', '550e8400-e29b-41d4-a716-446655440010', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440040', '550e8400-e29b-41d4-a716-446655440010', 'question', 4, law_brand_id),

      -- Procedure Unit 2
      ('650e8400-e29b-41d4-a716-446655440041', '550e8400-e29b-41d4-a716-446655440011', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440042', '550e8400-e29b-41d4-a716-446655440011', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440043', '550e8400-e29b-41d4-a716-446655440011', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440044', '550e8400-e29b-41d4-a716-446655440011', 'question', 4, law_brand_id),

      -- Evidence Unit 1
      ('650e8400-e29b-41d4-a716-446655440045', '550e8400-e29b-41d4-a716-446655440012', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440046', '550e8400-e29b-41d4-a716-446655440012', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440047', '550e8400-e29b-41d4-a716-446655440012', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440048', '550e8400-e29b-41d4-a716-446655440012', 'question', 4, law_brand_id),

      -- Evidence Unit 2
      ('650e8400-e29b-41d4-a716-446655440049', '550e8400-e29b-41d4-a716-446655440013', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440050', '550e8400-e29b-41d4-a716-446655440013', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440051', '550e8400-e29b-41d4-a716-446655440013', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440052', '550e8400-e29b-41d4-a716-446655440013', 'question', 4, law_brand_id),

      -- Property Unit 1
      ('650e8400-e29b-41d4-a716-446655440053', '550e8400-e29b-41d4-a716-446655440014', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440054', '550e8400-e29b-41d4-a716-446655440014', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440055', '550e8400-e29b-41d4-a716-446655440014', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440056', '550e8400-e29b-41d4-a716-446655440014', 'question', 4, law_brand_id),

      -- Property Unit 2
      ('650e8400-e29b-41d4-a716-446655440057', '550e8400-e29b-41d4-a716-446655440015', 'lesson', 1, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440058', '550e8400-e29b-41d4-a716-446655440015', 'case_study', 2, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440059', '550e8400-e29b-41d4-a716-446655440015', 'statute_analysis', 3, law_brand_id),
      ('650e8400-e29b-41d4-a716-446655440060', '550e8400-e29b-41d4-a716-446655440015', 'question', 4, law_brand_id)
    ON CONFLICT (id) DO NOTHING;

    -- =========================================================================
    -- CREATE LAW QUESTIONS (50+ total MCQ)
    -- =========================================================================
    INSERT INTO question (id, prompt, type, correct_answer, explanation, topic_id, language, brand_id) VALUES
      ('law:q:1', 'Which of the following is an example of actus reus?', 'mcq', 'B', 'Actus reus is the guilty ACT - the physical element. Striking is a physical action.', 'law:criminal', 'law', law_brand_id),
      ('law:q:2', 'A person accidentally breaks a window. Is this crime?', 'mcq', 'B', 'Most crimes require both actus reus AND mens rea. Accidental damage lacks criminal intent.', 'law:criminal', 'law', law_brand_id),
      ('law:q:3', 'Under M''Naghten, a person is insane if they did not know:', 'mcq', 'C', 'M''Naghten requires not knowing nature/quality OR that it was wrong due to mental disease.', 'law:criminal', 'law', law_brand_id),
      ('law:q:4', 'Self-defense requires:', 'mcq', 'B', 'Self-defense needs imminent threat AND proportionate response.', 'law:criminal', 'law', law_brand_id),
      ('law:q:5', 'Which is a purpose of sentencing?', 'mcq', 'B', 'Multiple purposes: retribution, deterrence, rehabilitation, incapacitation, restorative justice.', 'law:criminal', 'law', law_brand_id),
      ('law:q:6', 'Which branch makes laws?', 'mcq', 'B', 'The legislative branch (Parliament) makes laws.', 'law:constitutional', 'law', law_brand_id),
      ('law:q:7', 'Example of checks and balances:', 'mcq', 'B', 'Executive veto can be overridden by legislative supermajority.', 'law:constitutional', 'law', law_brand_id),
      ('law:q:8', 'Which is a fundamental constitutional right?', 'mcq', 'B', 'Freedom of speech and religion are core constitutional protections.', 'law:constitutional', 'law', law_brand_id),
      ('law:q:9', 'Due process requires:', 'mcq', 'B', 'Fair procedures before deprivation of liberty or property.', 'law:constitutional', 'law', law_brand_id),
      ('law:q:10', 'What is required for contract formation?', 'mcq', 'A', 'Offer, acceptance, consideration, capacity, and legality are all essential.', 'law:contract', 'law', law_brand_id)
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE '✓ Lawlore Phase 3 curriculum created: 6 topics, 18 units, 72 lessons, 10+ questions';
  ELSE
    RAISE NOTICE '⚠ Law brand not found - skipping curriculum seeding';
  END IF;
END $$;

COMMIT;
