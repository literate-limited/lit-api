import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

/**
 * Detect and link citations in legal document text
 * @param {string} brandId - Brand ID
 * @param {string} content - Text content to analyze
 * @param {string} documentId - Source document ID (statute or case)
 * @param {string} documentType - Type of source document ('statute' or 'case')
 */
export async function detectAndLinkCitations(brandId, content, documentId, documentType) {
  if (!content || !documentId) return;

  const citations = detectCitations(content);

  // Link each detected citation
  for (const citation of citations) {
    try {
      await linkCitation(brandId, documentId, documentType, citation);
    } catch (error) {
      console.warn('[CITATIONS] Failed to link citation:', citation, error.message);
    }
  }
}

/**
 * Detect citations in text using regex patterns
 * Returns array of citation objects with detected patterns
 */
export function detectCitations(content) {
  if (!content) return [];

  const citations = [];
  const seen = new Set();

  // Pattern 1: Commonwealth Acts
  // Examples: "Crimes Act 1995 (Cth)", "Crimes Act 1995 (Cth), s 23"
  const actPattern = /([A-Za-z\s]+)\s(\d{4})\s\(Cth\)(?:\s*,\s*(?:s|ss|section|sections)\s*([\d\-,\s]+))?/g;
  let match;

  while ((match = actPattern.exec(content)) !== null) {
    const citationText = match[0];
    if (!seen.has(citationText)) {
      citations.push({
        text: citationText,
        type: 'statute',
        pattern: 'commonwealth_act',
        title: match[1].trim(),
        year: parseInt(match[2]),
        sections: match[3] ? match[3].split(/[,\s]+/).filter(Boolean) : []
      });
      seen.add(citationText);
    }
  }

  // Pattern 2: Case citations - HCA format
  // Examples: "[2020] HCA 45", "[2023] HCA 42"
  const hcaCitationPattern = /\[(\d{4})\]\s+HCA\s+(\d+)/g;

  while ((match = hcaCitationPattern.exec(content)) !== null) {
    const citationText = match[0];
    if (!seen.has(citationText)) {
      citations.push({
        text: citationText,
        type: 'case',
        pattern: 'hca_citation',
        year: parseInt(match[1]),
        caseNumber: parseInt(match[2])
      });
      seen.add(citationText);
    }
  }

  // Pattern 3: Alternative statute citation format
  // Examples: "s. 23 of the Crimes Act", "section 23 of the Crimes Act 1995"
  const altActPattern = /(s(?:ection)?s?\.?\s+[\d\-,\s]+\s+of\s+the\s+([A-Za-z\s]+?)(?:\s+(\d{4}))?)/gi;

  while ((match = altActPattern.exec(content)) !== null) {
    const citationText = match[1];
    if (!seen.has(citationText)) {
      citations.push({
        text: citationText,
        type: 'statute',
        pattern: 'section_reference',
        title: match[2].trim(),
        year: match[3] ? parseInt(match[3]) : null
      });
      seen.add(citationText);
    }
  }

  // Pattern 4: CLR (Commonwealth Law Reports) citations
  // Examples: "200 CLR 1", "123 CLR 456"
  const clrPattern = /(\d+)\s+CLR\s+(\d+)/g;

  while ((match = clrPattern.exec(content)) !== null) {
    const citationText = match[0];
    if (!seen.has(citationText)) {
      citations.push({
        text: citationText,
        type: 'case',
        pattern: 'clr_citation',
        volume: parseInt(match[1]),
        page: parseInt(match[2])
      });
      seen.add(citationText);
    }
  }

  return citations;
}

/**
 * Link a detected citation to a document in the database
 */
async function linkCitation(brandId, sourceDocId, sourceType, citation) {
  let targetStatuteId = null;
  let targetCaseId = null;
  let confidenceScore = 0.5; // Default medium confidence

  // Try to find matching statute
  if (citation.type === 'statute') {
    const statute = await findStatute(brandId, citation);
    if (statute) {
      targetStatuteId = statute.id;
      confidenceScore = citation.pattern === 'commonwealth_act' ? 0.95 : 0.70;
    }
  }

  // Try to find matching case
  if (citation.type === 'case') {
    const caseDoc = await findCase(brandId, citation);
    if (caseDoc) {
      targetCaseId = caseDoc.id;
      confidenceScore = citation.pattern === 'hca_citation' ? 0.95 : 0.75;
    }
  }

  // Only create citation link if we found a target
  if (!targetStatuteId && !targetCaseId) {
    return;
  }

  // Create citation link
  try {
    await db.query(
      `INSERT INTO law_citations
        (id, brand_id, source_statute_id, source_case_id, target_statute_id, target_case_id, citation_text, citation_type, confidence_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'reference', $8)
       ON CONFLICT DO NOTHING`,
      [
        uuidv4(),
        brandId,
        sourceType === 'statute' ? sourceDocId : null,
        sourceType === 'case' ? sourceDocId : null,
        targetStatuteId,
        targetCaseId,
        citation.text,
        confidenceScore
      ]
    );
  } catch (error) {
    console.warn('[CITATIONS] Failed to insert citation link:', error.message);
  }
}

/**
 * Find matching statute by title and year
 */
async function findStatute(brandId, citation) {
  if (!citation.title) return null;

  try {
    // Search by title and optional year
    const query = `
      SELECT id FROM law_statutes
      WHERE brand_id = $1
        AND status = 'current'
        AND (
          LOWER(title) LIKE LOWER($2)
          OR LOWER(short_title) LIKE LOWER($2)
        )
      ${citation.year ? 'AND year = $3' : ''}
      LIMIT 1
    `;

    const params = [brandId, `%${citation.title}%`];
    if (citation.year) params.push(citation.year);

    const statute = await db.one(query, params);
    return statute;
  } catch (error) {
    console.warn('[CITATIONS] Error finding statute:', error.message);
    return null;
  }
}

/**
 * Find matching case by citation patterns
 */
async function findCase(brandId, citation) {
  if (!citation.text) return null;

  try {
    // Try exact citation match first
    let caseDoc = await db.one(
      `SELECT id FROM law_cases
       WHERE brand_id = $1 AND citation = $2
       LIMIT 1`,
      [brandId, citation.text]
    );

    if (caseDoc) return caseDoc;

    // If HCA citation, try reconstructing the citation format
    if (citation.pattern === 'hca_citation' && citation.year && citation.caseNumber) {
      const reconstructed = `[${citation.year}] HCA ${citation.caseNumber}`;
      caseDoc = await db.one(
        `SELECT id FROM law_cases
         WHERE brand_id = $1 AND citation = $2
         LIMIT 1`,
        [brandId, reconstructed]
      );
      if (caseDoc) return caseDoc;
    }

    // Try partial match for cases
    caseDoc = await db.one(
      `SELECT id FROM law_cases
       WHERE brand_id = $1
         AND (
           LOWER(title) LIKE LOWER($2)
           OR LOWER(citation) LIKE LOWER($2)
         )
       LIMIT 1`,
      [brandId, `%${citation.text.substring(0, 30)}%`]
    );

    return caseDoc;
  } catch (error) {
    console.warn('[CITATIONS] Error finding case:', error.message);
    return null;
  }
}

/**
 * Get citation statistics for a brand
 */
export async function getCitationStats(brandId) {
  try {
    const stats = await db.one(
      `SELECT
        COUNT(*) as total_citations,
        AVG(confidence_score) as avg_confidence,
        COUNT(DISTINCT source_statute_id) as statutes_citing,
        COUNT(DISTINCT source_case_id) as cases_citing,
        COUNT(DISTINCT target_statute_id) as statutes_cited,
        COUNT(DISTINCT target_case_id) as cases_cited
       FROM law_citations
       WHERE brand_id = $1`,
      [brandId]
    );

    return {
      totalCitations: parseInt(stats.total_citations) || 0,
      avgConfidence: parseFloat(stats.avg_confidence) || 0,
      statutesCiting: parseInt(stats.statutes_citing) || 0,
      casesCiting: parseInt(stats.cases_citing) || 0,
      statutesCited: parseInt(stats.statutes_cited) || 0,
      casesCited: parseInt(stats.cases_cited) || 0
    };
  } catch (error) {
    console.error('[CITATIONS] Error getting stats:', error);
    return {};
  }
}

/**
 * Delete citations with low confidence (cleanup utility)
 */
export async function deleteLowConfidenceCitations(brandId, threshold = 0.5) {
  try {
    const result = await db.query(
      `DELETE FROM law_citations
       WHERE brand_id = $1 AND confidence_score < $2`,
      [brandId, threshold]
    );

    return result;
  } catch (error) {
    console.error('[CITATIONS] Error deleting low confidence citations:', error);
    throw error;
  }
}
