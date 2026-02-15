import db from '../db.js';

/**
 * Search statutes and cases using PostgreSQL full-text search
 * @param {string} brandId - Brand ID for tenant isolation
 * @param {object} options - Search options
 * @returns {Promise<{results: Array, total: number, facets: object}>}
 */
export async function searchLaw(brandId, options = {}) {
  const {
    query = '',
    type = 'all', // 'statute', 'case', 'all'
    jurisdiction = null,
    yearFrom = null,
    yearTo = null,
    limit = 50,
    offset = 0
  } = options;

  if (!query || query.trim().length === 0) {
    return { results: [], total: 0, facets: {} };
  }

  const results = [];
  const queryTsVector = query.trim().split(/\s+/).join(' & ');

  try {
    // Search statutes
    if (type === 'statute' || type === 'all') {
      const statutes = await searchStatutes(
        brandId,
        queryTsVector,
        jurisdiction,
        yearFrom,
        yearTo,
        limit,
        offset
      );
      results.push(...statutes.map(s => ({
        id: s.id,
        type: 'statute',
        title: s.title,
        shortTitle: s.short_title,
        citation: `${s.short_title || s.title}${s.year ? ` (${s.year})` : ''}`,
        jurisdiction: s.jurisdiction,
        year: s.year,
        status: s.status,
        excerpt: generateExcerpt(s.content, query),
        url: `/statute/${s.id}`,
        score: s.score
      })));
    }

    // Search cases
    if (type === 'case' || type === 'all') {
      const cases = await searchCases(
        brandId,
        queryTsVector,
        jurisdiction,
        yearFrom,
        yearTo,
        limit,
        offset
      );
      results.push(...cases.map(c => ({
        id: c.id,
        type: 'case',
        title: c.title,
        citation: c.citation,
        court: c.court,
        year: c.year,
        jurisdiction: c.jurisdiction,
        excerpt: generateExcerpt(c.content, query),
        url: `/case/${c.id}`,
        score: c.score
      })));
    }

    // Sort combined results by relevance score
    results.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Apply limit/offset to combined results
    const paginatedResults = results.slice(offset, offset + limit);

    // Get facets for filtering
    const facets = await getFacets(brandId, type);

    return {
      results: paginatedResults,
      total: results.length,
      facets
    };
  } catch (error) {
    console.error('Law search error:', error);
    throw error;
  }
}

/**
 * Search statutes table
 */
async function searchStatutes(
  brandId,
  queryTsVector,
  jurisdiction,
  yearFrom,
  yearTo,
  limit,
  offset
) {
  let query = `
    SELECT
      id, title, short_title, content, jurisdiction, year, status,
      ts_rank(content_tsvector, plainto_tsquery('english', $2)) as score
    FROM law_statutes
    WHERE brand_id = $1
      AND content_tsvector @@ plainto_tsquery('english', $2)
      AND status = 'current'
  `;

  const params = [brandId, queryTsVector.replace(/&/g, ' ')];

  if (jurisdiction) {
    query += ` AND jurisdiction = $${params.length + 1}`;
    params.push(jurisdiction);
  }

  if (yearFrom !== null) {
    query += ` AND year >= $${params.length + 1}`;
    params.push(yearFrom);
  }

  if (yearTo !== null) {
    query += ` AND year <= $${params.length + 1}`;
    params.push(yearTo);
  }

  query += ` ORDER BY score DESC, year DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit * 2); // Fetch more for later dedup
  params.push(offset);

  return db.many(query, params);
}

/**
 * Search cases table
 */
async function searchCases(
  brandId,
  queryTsVector,
  jurisdiction,
  yearFrom,
  yearTo,
  limit,
  offset
) {
  let query = `
    SELECT
      id, title, content, citation, court, jurisdiction, year,
      ts_rank(content_tsvector, plainto_tsquery('english', $2)) as score
    FROM law_cases
    WHERE brand_id = $1
      AND content_tsvector @@ plainto_tsquery('english', $2)
  `;

  const params = [brandId, queryTsVector.replace(/&/g, ' ')];

  if (jurisdiction) {
    query += ` AND jurisdiction = $${params.length + 1}`;
    params.push(jurisdiction);
  }

  if (yearFrom !== null) {
    query += ` AND year >= $${params.length + 1}`;
    params.push(yearFrom);
  }

  if (yearTo !== null) {
    query += ` AND year <= $${params.length + 1}`;
    params.push(yearTo);
  }

  query += ` ORDER BY score DESC, year DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit * 2);
  params.push(offset);

  return db.many(query, params);
}

/**
 * Get a statute by ID
 */
export async function getStatute(brandId, statuteId) {
  const statute = await db.one(
    `SELECT * FROM law_statutes WHERE id = $1 AND brand_id = $2`,
    [statuteId, brandId]
  );

  if (!statute) return null;

  return {
    id: statute.id,
    title: statute.title,
    shortTitle: statute.short_title,
    content: statute.content,
    jurisdiction: statute.jurisdiction,
    status: statute.status,
    year: statute.year,
    effectiveDate: statute.effective_date,
    repealDate: statute.repeal_date,
    url: statute.url,
    sections: statute.sections,
    amendments: statute.amendments,
    createdAt: statute.created_at,
    updatedAt: statute.updated_at
  };
}

/**
 * Get a case by ID
 */
export async function getCase(brandId, caseId) {
  const caseRow = await db.one(
    `SELECT * FROM law_cases WHERE id = $1 AND brand_id = $2`,
    [caseId, brandId]
  );

  if (!caseRow) return null;

  return {
    id: caseRow.id,
    title: caseRow.title,
    citation: caseRow.citation,
    citations: caseRow.citations,
    content: caseRow.content,
    court: caseRow.court,
    judges: caseRow.judges,
    year: caseRow.year,
    headnotes: caseRow.headnotes,
    holding: caseRow.holding,
    jurisdiction: caseRow.jurisdiction,
    url: caseRow.url,
    createdAt: caseRow.created_at,
    updatedAt: caseRow.updated_at
  };
}

/**
 * Get documents citing a statute
 */
export async function getStatuteCitations(brandId, statuteId, limit = 50, offset = 0) {
  const citations = await db.many(
    `SELECT DISTINCT
      CASE WHEN source_case_id IS NOT NULL THEN 'case' ELSE 'statute' END as type,
      COALESCE(source_case_id, source_statute_id) as id,
      COALESCE(c.title, s.title) as title,
      c.citation as citation,
      c.year as year,
      c.court as court,
      s.year as statute_year,
      citation_text, confidence_score
    FROM law_citations lc
    LEFT JOIN law_cases c ON lc.source_case_id = c.id
    LEFT JOIN law_statutes s ON lc.source_statute_id = s.id
    WHERE lc.brand_id = $1 AND lc.target_statute_id = $2
    ORDER BY confidence_score DESC, lc.created_at DESC
    LIMIT $3 OFFSET $4`,
    [brandId, statuteId, limit, offset]
  );

  return citations.map(c => ({
    type: c.type,
    id: c.id,
    title: c.title,
    citation: c.citation || c.title,
    year: c.year || c.statute_year,
    court: c.court,
    citationText: c.citation_text,
    confidenceScore: parseFloat(c.confidence_score)
  }));
}

/**
 * Get documents cited by a case
 */
export async function getCaseCitations(brandId, caseId, limit = 50, offset = 0) {
  const citations = await db.many(
    `SELECT DISTINCT
      CASE WHEN target_statute_id IS NOT NULL THEN 'statute' ELSE 'case' END as type,
      COALESCE(target_statute_id, target_case_id) as id,
      COALESCE(s.title, c2.title) as title,
      COALESCE(s.short_title, c2.citation) as citation,
      s.year as statute_year,
      c2.year as case_year,
      citation_text, confidence_score
    FROM law_citations lc
    LEFT JOIN law_statutes s ON lc.target_statute_id = s.id
    LEFT JOIN law_cases c2 ON lc.target_case_id = c2.id
    WHERE lc.brand_id = $1 AND lc.source_case_id = $2
    ORDER BY confidence_score DESC, lc.created_at DESC
    LIMIT $3 OFFSET $4`,
    [brandId, caseId, limit, offset]
  );

  return citations.map(c => ({
    type: c.type,
    id: c.id,
    title: c.title,
    citation: c.citation,
    year: c.statute_year || c.case_year,
    citationText: c.citation_text,
    confidenceScore: parseFloat(c.confidence_score)
  }));
}

/**
 * Get facets for search filters
 */
async function getFacets(brandId, type) {
  const facets = {
    jurisdictions: [],
    years: { min: null, max: null },
    types: []
  };

  try {
    // Get jurisdictions
    if (type === 'statute' || type === 'all') {
      const jurisdictions = await db.many(
        `SELECT DISTINCT jurisdiction, COUNT(*) as count
         FROM law_statutes
         WHERE brand_id = $1 AND status = 'current'
         GROUP BY jurisdiction
         ORDER BY count DESC`,
        [brandId]
      );
      facets.jurisdictions = jurisdictions.map(j => ({
        code: j.jurisdiction,
        name: getJurisdictionName(j.jurisdiction),
        count: parseInt(j.count)
      }));
    }

    if (type === 'case' || type === 'all') {
      const caseJurisdictions = await db.many(
        `SELECT DISTINCT jurisdiction, COUNT(*) as count
         FROM law_cases
         WHERE brand_id = $1
         GROUP BY jurisdiction
         ORDER BY count DESC`,
        [brandId]
      );
      facets.jurisdictions = [
        ...facets.jurisdictions,
        ...caseJurisdictions
          .filter(j => !facets.jurisdictions.find(f => f.code === j.jurisdiction))
          .map(j => ({
            code: j.jurisdiction,
            name: getJurisdictionName(j.jurisdiction),
            count: parseInt(j.count)
          }))
      ];
    }

    // Get year range
    if (type === 'statute' || type === 'all') {
      const yearRange = await db.one(
        `SELECT MIN(year) as min_year, MAX(year) as max_year
         FROM law_statutes
         WHERE brand_id = $1 AND year IS NOT NULL`,
        [brandId]
      );
      if (yearRange.min_year) {
        facets.years.min = parseInt(yearRange.min_year);
      }
      if (yearRange.max_year) {
        facets.years.max = parseInt(yearRange.max_year);
      }
    }

    if (type === 'case' || type === 'all') {
      const caseYearRange = await db.one(
        `SELECT MIN(year) as min_year, MAX(year) as max_year
         FROM law_cases
         WHERE brand_id = $1 AND year IS NOT NULL`,
        [brandId]
      );
      if (caseYearRange.min_year && (!facets.years.min || caseYearRange.min_year < facets.years.min)) {
        facets.years.min = parseInt(caseYearRange.min_year);
      }
      if (caseYearRange.max_year && (!facets.years.max || caseYearRange.max_year > facets.years.max)) {
        facets.years.max = parseInt(caseYearRange.max_year);
      }
    }

    // Document types
    if (type === 'all' || type === 'statute') {
      facets.types.push({ code: 'statute', name: 'Statutes', count: 0 });
    }
    if (type === 'all' || type === 'case') {
      facets.types.push({ code: 'case', name: 'Cases', count: 0 });
    }

    return facets;
  } catch (error) {
    console.error('Facets fetch error:', error);
    return facets;
  }
}

/**
 * Generate excerpt from content around search terms
 */
function generateExcerpt(content, query, length = 150) {
  if (!content) return '';

  const searchTerms = query.split(/\s+/);
  const contentLower = content.toLowerCase();

  // Find first occurrence of any search term
  let position = -1;
  for (const term of searchTerms) {
    const index = contentLower.indexOf(term.toLowerCase());
    if (index !== -1 && (position === -1 || index < position)) {
      position = index;
    }
  }

  if (position === -1) {
    // No search term found, return start of content
    return content.substring(0, length) + (content.length > length ? '...' : '');
  }

  // Extract excerpt around position
  const start = Math.max(0, position - 50);
  const end = Math.min(content.length, start + length);
  let excerpt = content.substring(start, end);

  if (start > 0) excerpt = '...' + excerpt;
  if (end < content.length) excerpt = excerpt + '...';

  return excerpt;
}

/**
 * Map jurisdiction codes to names
 */
function getJurisdictionName(code) {
  const jurisdictionNames = {
    'cth': 'Commonwealth',
    'hca': 'High Court of Australia',
    'nsw': 'New South Wales',
    'vic': 'Victoria',
    'qld': 'Queensland',
    'wa': 'Western Australia',
    'sa': 'South Australia',
    'tas': 'Tasmania',
    'act': 'Australian Capital Territory',
    'nt': 'Northern Territory'
  };
  return jurisdictionNames[code] || code;
}
