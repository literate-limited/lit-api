import db from '../db.js';

/**
 * Citation Analytics Service
 * Provides analytics on citations, usage patterns, and legal document influence
 */

/**
 * Get overall citation statistics
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
    console.error('[ANALYTICS] Error getting citation stats:', error);
    return {};
  }
}

/**
 * Get most cited statutes
 */
export async function getMostCitedStatutes(brandId, limit = 20) {
  try {
    const results = await db.many(
      `SELECT
        s.id,
        s.title,
        s.short_title,
        s.year,
        COUNT(DISTINCT lc.id) as citation_count,
        COUNT(DISTINCT lc.source_case_id) as cited_by_cases,
        COUNT(DISTINCT lc.source_statute_id) as cited_by_statutes,
        AVG(lc.confidence_score) as avg_confidence
       FROM law_statutes s
       LEFT JOIN law_citations lc ON s.id = lc.target_statute_id
       WHERE s.brand_id = $1
       GROUP BY s.id, s.title, s.short_title, s.year
       HAVING COUNT(DISTINCT lc.id) > 0
       ORDER BY citation_count DESC
       LIMIT $2`,
      [brandId, limit]
    );

    return results.map(r => ({
      id: r.id,
      title: r.title,
      shortTitle: r.short_title,
      year: r.year,
      citationCount: parseInt(r.citation_count),
      citedByCases: parseInt(r.cited_by_cases),
      citedByStatutes: parseInt(r.cited_by_statutes),
      avgConfidence: parseFloat(r.avg_confidence)
    }));
  } catch (error) {
    console.error('[ANALYTICS] Error getting most cited statutes:', error);
    return [];
  }
}

/**
 * Get most cited cases
 */
export async function getMostCitedCases(brandId, limit = 20) {
  try {
    const results = await db.many(
      `SELECT
        c.id,
        c.title,
        c.citation,
        c.year,
        COUNT(DISTINCT lc.id) as citation_count,
        COUNT(DISTINCT lc.source_case_id) as cited_by_cases,
        AVG(lc.confidence_score) as avg_confidence
       FROM law_cases c
       LEFT JOIN law_citations lc ON c.id = lc.target_case_id
       WHERE c.brand_id = $1
       GROUP BY c.id, c.title, c.citation, c.year
       HAVING COUNT(DISTINCT lc.id) > 0
       ORDER BY citation_count DESC
       LIMIT $2`,
      [brandId, limit]
    );

    return results.map(r => ({
      id: r.id,
      title: r.title,
      citation: r.citation,
      year: r.year,
      citationCount: parseInt(r.citation_count),
      citedByCases: parseInt(r.cited_by_cases),
      avgConfidence: parseFloat(r.avg_confidence)
    }));
  } catch (error) {
    console.error('[ANALYTICS] Error getting most cited cases:', error);
    return [];
  }
}

/**
 * Get citation trends by year
 */
export async function getCitationTrends(brandId, groupBy = 'year') {
  try {
    let groupField = 'EXTRACT(YEAR FROM lc.created_at)';

    if (groupBy === 'month') {
      groupField = `TO_CHAR(lc.created_at, 'YYYY-MM')`;
    } else if (groupBy === 'quarter') {
      groupField = `TO_CHAR(lc.created_at, 'YYYY-"Q"Q')`;
    }

    const results = await db.many(
      `SELECT
        ${groupField} as period,
        COUNT(*) as citation_count,
        AVG(confidence_score) as avg_confidence,
        COUNT(DISTINCT source_statute_id) as statutes_citing,
        COUNT(DISTINCT source_case_id) as cases_citing
       FROM law_citations lc
       WHERE lc.brand_id = $1
       GROUP BY ${groupField}
       ORDER BY period DESC
       LIMIT 100`,
      [brandId]
    );

    return results.map(r => ({
      period: r.period,
      citationCount: parseInt(r.citation_count),
      avgConfidence: parseFloat(r.avg_confidence),
      statutesCiting: parseInt(r.statutes_citing),
      casesCiting: parseInt(r.cases_citing)
    }));
  } catch (error) {
    console.error('[ANALYTICS] Error getting citation trends:', error);
    return [];
  }
}

/**
 * Get citation influence score for a statute
 * Based on: number of citations, confidence scores, recency
 */
export async function getStatuteInfluence(brandId, statuteId) {
  try {
    const citations = await db.many(
      `SELECT
        confidence_score,
        created_at
       FROM law_citations
       WHERE brand_id = $1 AND target_statute_id = $2`,
      [brandId, statuteId]
    );

    if (citations.length === 0) {
      return { score: 0, description: 'No citations found' };
    }

    // Calculate influence score:
    // 40% from count, 40% from average confidence, 20% from recency
    const count = citations.length;
    const avgConfidence = citations.reduce((sum, c) => sum + parseFloat(c.confidence_score), 0) / citations.length;

    // Recency score: recent citations weighted higher
    const now = new Date();
    const recencyScores = citations.map(c => {
      const days = (now - new Date(c.created_at)) / (1000 * 60 * 60 * 24);
      return Math.max(0, 1 - (days / 365)); // Decay over 1 year
    });
    const avgRecency = recencyScores.reduce((sum, s) => sum + s, 0) / recencyScores.length;

    // Normalize count (assume 20+ citations is high influence)
    const countScore = Math.min(count / 20, 1);

    // Overall influence score
    const influenceScore = (countScore * 0.4) + (avgConfidence * 0.4) + (avgRecency * 0.2);

    return {
      score: Math.round(influenceScore * 100) / 100,
      citationCount: count,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      avgRecency: Math.round(avgRecency * 100) / 100,
      description: getInfluenceDescription(influenceScore)
    };
  } catch (error) {
    console.error('[ANALYTICS] Error getting statute influence:', error);
    return { score: 0, description: 'Error calculating influence' };
  }
}

/**
 * Get citation influence score for a case
 */
export async function getCaseInfluence(brandId, caseId) {
  try {
    const citations = await db.many(
      `SELECT
        confidence_score,
        created_at
       FROM law_citations
       WHERE brand_id = $1 AND target_case_id = $2`,
      [brandId, caseId]
    );

    if (citations.length === 0) {
      return { score: 0, description: 'No citations found' };
    }

    const count = citations.length;
    const avgConfidence = citations.reduce((sum, c) => sum + parseFloat(c.confidence_score), 0) / citations.length;

    const now = new Date();
    const recencyScores = citations.map(c => {
      const days = (now - new Date(c.created_at)) / (1000 * 60 * 60 * 24);
      return Math.max(0, 1 - (days / 365));
    });
    const avgRecency = recencyScores.reduce((sum, s) => sum + s, 0) / recencyScores.length;

    const countScore = Math.min(count / 20, 1);
    const influenceScore = (countScore * 0.4) + (avgConfidence * 0.4) + (avgRecency * 0.2);

    return {
      score: Math.round(influenceScore * 100) / 100,
      citationCount: count,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      avgRecency: Math.round(avgRecency * 100) / 100,
      description: getInfluenceDescription(influenceScore)
    };
  } catch (error) {
    console.error('[ANALYTICS] Error getting case influence:', error);
    return { score: 0, description: 'Error calculating influence' };
  }
}

/**
 * Get citation network summary
 */
export async function getCitationNetwork(brandId) {
  try {
    const network = await db.one(
      `SELECT
        COUNT(DISTINCT source_statute_id) as statute_nodes,
        COUNT(DISTINCT source_case_id) as case_nodes,
        COUNT(DISTINCT target_statute_id) as target_statute_nodes,
        COUNT(DISTINCT target_case_id) as target_case_nodes,
        COUNT(*) as edges,
        AVG(confidence_score) as avg_edge_confidence
       FROM law_citations
       WHERE brand_id = $1`,
      [brandId]
    );

    const totalNodes =
      (parseInt(network.statute_nodes) || 0) +
      (parseInt(network.case_nodes) || 0) +
      (parseInt(network.target_statute_nodes) || 0) +
      (parseInt(network.target_case_nodes) || 0);

    return {
      totalNodes: totalNodes,
      statuteNodes: (parseInt(network.statute_nodes) || 0) + (parseInt(network.target_statute_nodes) || 0),
      caseNodes: (parseInt(network.case_nodes) || 0) + (parseInt(network.target_case_nodes) || 0),
      totalEdges: parseInt(network.edges) || 0,
      avgEdgeConfidence: parseFloat(network.avg_edge_confidence) || 0,
      density: totalNodes > 0 ? ((parseInt(network.edges) || 0) / (totalNodes * (totalNodes - 1) / 2)) : 0
    };
  } catch (error) {
    console.error('[ANALYTICS] Error getting citation network:', error);
    return {};
  }
}

/**
 * Get related documents (highly cited together)
 */
export async function getRelatedDocuments(brandId, documentId, documentType = 'statute', limit = 10) {
  try {
    let query;

    if (documentType === 'statute') {
      // Find statutes that cite the same documents
      query = `
        SELECT DISTINCT
          s2.id,
          s2.title,
          s2.year,
          COUNT(DISTINCT c2.target_statute_id) as shared_citations
        FROM law_citations c1
        JOIN law_citations c2 ON c1.target_statute_id = c2.target_statute_id
        JOIN law_statutes s2 ON c2.source_statute_id = s2.id
        WHERE c1.brand_id = $1
          AND c2.brand_id = $1
          AND c1.source_statute_id = $2
          AND s2.id != $2
        GROUP BY s2.id, s2.title, s2.year
        ORDER BY shared_citations DESC
        LIMIT $3
      `;
    } else {
      // Find cases that cite the same documents
      query = `
        SELECT DISTINCT
          c2_case.id,
          c2_case.title,
          c2_case.citation,
          c2_case.year,
          COUNT(DISTINCT lc2.target_statute_id) as shared_citations
        FROM law_citations lc1
        JOIN law_citations lc2 ON lc1.target_statute_id = lc2.target_statute_id
        JOIN law_cases c2_case ON lc2.source_case_id = c2_case.id
        WHERE lc1.brand_id = $1
          AND lc2.brand_id = $1
          AND lc1.source_case_id = $2
          AND c2_case.id != $2
        GROUP BY c2_case.id, c2_case.title, c2_case.citation, c2_case.year
        ORDER BY shared_citations DESC
        LIMIT $3
      `;
    }

    return await db.many(query, [brandId, documentId, limit]);
  } catch (error) {
    console.error('[ANALYTICS] Error getting related documents:', error);
    return [];
  }
}

/**
 * Get human-readable influence description
 */
function getInfluenceDescription(score) {
  if (score >= 0.8) return 'Highly influential';
  if (score >= 0.6) return 'Very influential';
  if (score >= 0.4) return 'Influential';
  if (score >= 0.2) return 'Moderately cited';
  return 'Minimally cited';
}
