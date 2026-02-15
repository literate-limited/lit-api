-- Migration 022: ACARA F-10 Science Indicators
-- Maps ACARA Australian Curriculum F-10 science framework to learning spine
-- Covers all three strands: Physical Sciences, Biological Sciences, Earth & Space Sciences

-- ============================================================================
-- Seed: ACARA F-10 Science Indicators
-- ============================================================================
DO $$
DECLARE
  sci_brand_id UUID;
BEGIN
  -- Get or find science brand
  SELECT id INTO sci_brand_id FROM brands WHERE code = 'scythe_science' LIMIT 1;

  IF sci_brand_id IS NULL THEN
    -- Science brand doesn't exist yet, try to find any science-related brand or create reference
    -- This allows the migration to run idempotently
    RETURN;
  END IF;

  -- ============================================================================
  -- PHYSICAL SCIENCES
  -- ============================================================================

  -- PS.F-2: Foundation to Year 2 - Matter & Energy
  INSERT INTO learning_spine_indicator
    (id, brand_id, app_code, framework_code, subject_area, indicator_code, title, description, level_band, cognitive_level)
  VALUES
    ('ls:sci:ps:mat-props-f2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU018', 'Material Properties F-2', 'Identify and describe common materials and their observable properties.', 'F-2', 'recall'),
    ('ls:sci:ps:change-states-f2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU019', 'States of Matter F-2', 'Recognize that objects can be made from different materials and changed through physical processes.', 'F-2', 'apply'),
    ('ls:sci:ps:light-shadow-k2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU020', 'Light & Shadow F-2', 'Identify that light from a range of sources can be seen and can cast shadows.', 'F-2', 'apply'),
    ('ls:sci:ps:forces-motion-k2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU021', 'Forces & Motion F-2', 'Observe that things move in different ways, at different speeds, on different paths and that these can be affected by pushing or pulling.', 'F-2', 'apply'),

    ('ls:sci:ps:mat-props-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU031', 'Material Properties 3-4', 'Investigate and identify processes that change materials into other materials.', '3-4', 'apply'),
    ('ls:sci:ps:energy-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU033', 'Energy & Light 3-4', 'Recognize that light and sound are produced by a range of sources and can travel through different materials.', '3-4', 'apply'),
    ('ls:sci:ps:forces-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU035', 'Forces 3-4', 'Identify and describe pushes and pulls, and the effects they have on the motion of familiar objects on Earth and in space.', '3-4', 'apply'),

    ('ls:sci:ps:mat-pure-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU074', 'Pure & Mixed Materials 5-6', 'Investigate and classify materials as pure substances or mixtures.', '5-6', 'analyze'),
    ('ls:sci:ps:energy-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU076', 'Energy Transfer 5-6', 'Describe the movement of Earth and objects on Earth relative to the Sun and explain seasons, day and night.', '5-6', 'apply'),
    ('ls:sci:ps:forces-motion-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU077', 'Forces & Motion 5-6', 'Identify and describe the action of balanced and unbalanced forces on familiar objects.', '5-6', 'analyze'),

    ('ls:sci:ps:mat-structure-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU112', 'Particle Model 7-8', 'Investigate the relationship between properties of materials and their atomic structure and bonding.', '7-8', 'analyze'),
    ('ls:sci:ps:energy-forms-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU114', 'Energy Forms 7-8', 'Analyze and describe the transformation and flow of energy in mechanical, thermal and electrical systems.', '7-8', 'analyze'),
    ('ls:sci:ps:forces-motion-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU116', 'Motion & Forces 7-8', 'Explain and predict motion of objects when subjected to a combination of balanced and unbalanced forces.', '7-8', 'analyze'),

    ('ls:sci:ps:chem-reactions-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU177', 'Chemical Reactions 9-10', 'Classify and describe different types of chemical reactions and explain how to identify them.', '9-10', 'analyze'),
    ('ls:sci:ps:energy-conservation-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU182', 'Energy Conservation 9-10', 'Describe and explain relationships in the motion of objects in terms of Newton''s Laws of Motion.', '9-10', 'analyze'),
    ('ls:sci:ps:waves-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'physical-science', 'ACSSU189', 'Waves & Optics 9-10', 'Analyse how the properties of waves explain the reflection, refraction and diffraction of light.', '9-10', 'analyze'),

  -- ============================================================================
  -- BIOLOGICAL SCIENCES
  -- ============================================================================

    ('ls:sci:bs:life-processes-f2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU002', 'Life Processes F-2', 'Identify the basic features of living things and recognize that living things grow, change and have basic needs.', 'F-2', 'recall'),
    ('ls:sci:bs:animals-habitats-k2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU004', 'Animal Habitats F-2', 'Observe and identify how living things are different in appearance and describe some similarities and differences between animals.', 'F-2', 'apply'),
    ('ls:sci:bs:plant-growth-f2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU043', 'Plants Needs F-2', 'Recognize that plants are living things that grow, change and have similar life processes to animals.', 'F-2', 'apply'),

    ('ls:sci:bs:living-things-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU044', 'Living Processes 3-4', 'Identify and classify plants and animals based on observable features and describe basic plant and animal life processes.', '3-4', 'apply'),
    ('ls:sci:bs:food-chains-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU072', 'Food Chains 3-4', 'Describe how plants produce food from sunlight and how animals obtain their food from plants or other animals.', '3-4', 'apply'),

    ('ls:sci:bs:growth-reproduction-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU071', 'Growth & Reproduction 5-6', 'Investigate and describe the life processes of living organisms and life cycles of plants and animals including decomposition.', '5-6', 'analyze'),
    ('ls:sci:bs:ecosystems-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU073', 'Ecosystems 5-6', 'Describe relationships between the components of simple food chains and food webs, and the impact of changing the numbers of organisms.', '5-6', 'analyze'),
    ('ls:sci:bs:classification-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU075', 'Classification 5-6', 'Classify living things based on observable characteristics and describe how this classification helps organize the diverse range of life forms.', '5-6', 'analyze'),

    ('ls:sci:bs:cells-organisms-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU111', 'Cells 7-8', 'Investigate how the structures and properties of materials relate to their uses by analyzing relationships between cells and organisms.', '7-8', 'analyze'),
    ('ls:sci:bs:ecosystems-biomes-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU113', 'Biomes & Ecosystems 7-8', 'Explain how energy is transferred through ecosystems via food chains, food webs and the cycling of matter through decomposition.', '7-8', 'analyze'),
    ('ls:sci:bs:body-systems-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU115', 'Body Systems 7-8', 'Identify and describe major body systems and explain their role in maintaining body functions and health.', '7-8', 'analyze'),

    ('ls:sci:bs:genetics-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU175', 'Genetics 9-10', 'Analyse patterns in the inheritance of traits in families and predict the likelihood of inheritance of genetic conditions.', '9-10', 'analyze'),
    ('ls:sci:bs:evolution-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU176', 'Evolution & Diversity 9-10', 'Describe and explain the implications of evolutionary processes for the diversity of life on Earth.', '9-10', 'analyze'),
    ('ls:sci:bs:ecosystems-dynamics-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'biological-science', 'ACSSU180', 'Ecosystem Dynamics 9-10', 'Analyse how matter is cycled through ecosystems including the carbon cycle and nutrient cycles.', '9-10', 'analyze'),

  -- ============================================================================
  -- EARTH & SPACE SCIENCES
  -- ============================================================================

    ('ls:sci:ess:earth-materials-f2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU003', 'Earth Materials F-2', 'Observe and describe different materials on Earth and their uses.', 'F-2', 'recall'),
    ('ls:sci:ess:sky-changes-f2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU005', 'Sky Objects F-2', 'Identify and describe the sun, moon and stars as objects in the sky that can be observed from Earth.', 'F-2', 'apply'),

    ('ls:sci:ess:earth-features-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU040', 'Earth Features 3-4', 'Observe and describe different places and how their environments are shaped by physical processes.', '3-4', 'apply'),
    ('ls:sci:ess:water-cycle-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU045', 'Water & Weather 3-4', 'Observe and describe weather patterns and how water is an important resource that cycles through the environment.', '3-4', 'apply'),
    ('ls:sci:ess:space-sun-moon-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU048', 'Sun & Moon 3-4', 'Identify the movement of the Sun and the Moon and the sequences of day and night, seasons and years.', '3-4', 'apply'),

    ('ls:sci:ess:rocks-minerals-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU065', 'Rocks & Minerals 5-6', 'Investigate the properties of rocks and minerals, and explain the formation of rocks and their uses.', '5-6', 'analyze'),
    ('ls:sci:ess:water-features-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU069', 'Water Cycle 5-6', 'Explain the role of water in the water cycle and how this cycle is essential for life on Earth.', '5-6', 'analyze'),
    ('ls:sci:ess:earth-space-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU078', 'Earth & Space 5-6', 'Describe and predict the effect of the relative positions of the Earth, Sun and Moon on phenomena on Earth including seasons and tides.', '5-6', 'analyze'),
    ('ls:sci:ess:weather-climate-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU080', 'Weather & Climate 5-6', 'Investigate the effect of climate on the environment and human activities, and identify the impact of human activities on the environment.', '5-6', 'analyze'),

    ('ls:sci:ess:plate-tectonics-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU119', 'Plate Tectonics 7-8', 'Describe the structure of the Earth and explain how the theory of plate tectonics accounts for geological phenomena.', '7-8', 'analyze'),
    ('ls:sci:ess:rocks-cycle-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU120', 'Rock Cycle 7-8', 'Analyse the role of the rock cycle in forming different types of rocks and the importance of rocks for human uses.', '7-8', 'analyze'),
    ('ls:sci:ess:weather-systems-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU121', 'Weather & Atmosphere 7-8', 'Explain how the atmosphere protects Earth and how weather patterns and climate are affected by interactions in the atmosphere.', '7-8', 'analyze'),
    ('ls:sci:ess:cosmos-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU122', 'The Solar System 7-8', 'Describe the structure of the solar system and explain the phenomena associated with planetary motion in the solar system.', '7-8', 'analyze'),

    ('ls:sci:ess:geological-time-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU178', 'Geological Time 9-10', 'Analyse the evidence for the age of the Earth and the sequence of major geological events.', '9-10', 'analyze'),
    ('ls:sci:ess:climate-change-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU179', 'Climate Systems 9-10', 'Describe and explain the processes involved in climate change and the evidence for climate change.', '9-10', 'analyze'),
    ('ls:sci:ess:resource-cycles-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'earth-space-science', 'ACSSU181', 'Earth Resources 9-10', 'Analyse the processes involved in the formation of Earth resources and explain the implications of using Earth resources.', '9-10', 'analyze'),

  -- ============================================================================
  -- SCIENCE INQUIRY & PRACTICES (Cross-strand)
  -- ============================================================================

    ('ls:sci:inquiry:investigation-f-2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS005', 'Investigations F-2', 'Plan and conduct investigations to answer questions and identify relationships between variables.', 'F-2', 'apply'),
    ('ls:sci:inquiry:safety-f-2', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS007', 'Safe Practices F-2', 'Apply appropriate safety procedures in practical work and use equipment safely.', 'F-2', 'apply'),

    ('ls:sci:inquiry:investigation-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS008', 'Planning Investigations 3-4', 'Plan and conduct investigations to answer questions about living things, materials and physical phenomena.', '3-4', 'apply'),
    ('ls:sci:inquiry:questioning-3-4', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS009', 'Scientific Questions 3-4', 'Identify and ask questions that can be investigated scientifically.', '3-4', 'apply'),

    ('ls:sci:inquiry:investigation-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS016', 'Design Investigations 5-6', 'Decide when and how to conduct investigations to ensure evidence is reliable and valid.', '5-6', 'analyze'),
    ('ls:sci:inquiry:analysis-5-6', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS017', 'Data Analysis 5-6', 'Conduct investigations in a controlled way, identify variables, collect data and use a range of representations to communicate findings.', '5-6', 'analyze'),

    ('ls:sci:inquiry:design-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS123', 'Investigation Design 7-8', 'Design and conduct investigations involving different variables, types of data and a range of methods.', '7-8', 'analyze'),
    ('ls:sci:inquiry:evidence-7-8', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS124', 'Scientific Evidence 7-8', 'Analyse data and communicate findings in a variety of ways, evaluating the reliability and validity of results.', '7-8', 'analyze'),

    ('ls:sci:inquiry:methodology-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS191', 'Experimental Design 9-10', 'Design and conduct investigations involving multiple variables to determine relationships between independent and dependent variables.', '9-10', 'analyze'),
    ('ls:sci:inquiry:modelling-9-10', sci_brand_id, 'scythe_science', 'acara-f10-v1', 'science-inquiry', 'ACSIS193', 'Scientific Modelling 9-10', 'Represent the results of investigations, predicted patterns or relationships between variables in a variety of ways including graphs, simple models and equations.', '9-10', 'evaluate')
  ON CONFLICT (id) DO NOTHING;

END $$;

-- ============================================================================
-- Audit: Log this migration
-- ============================================================================
INSERT INTO progress_sync_log (app_code, sync_type, records_synced, status)
VALUES ('scythe_science', 'acara_science_indicators_migration',
  (SELECT COUNT(*) FROM learning_spine_indicator WHERE app_code = 'scythe_science'),
  'success'
);
