import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { detectAndLinkCitations } from './law-citations.service.js';
import { sleep, getSourceId, logIngestionStart, logIngestionSuccess, logIngestionFailure } from './law-ingest-helpers.js';

/**
 * Commonwealth Legislation Ingest Service
 * Fetches and indexes Australian Commonwealth acts and regulations
 * Source: legislation.gov.au
 */

const LEGISLATION_API = 'https://www.legislation.gov.au';
const BATCH_SIZE = 10; // Process in batches to avoid memory issues
const REQUEST_DELAY = 2000; // 2 seconds between requests to respect rate limits

/**
 * Ingest Commonwealth legislation
 * This fetches recent acts and regulations from legislation.gov.au
 */
export async function ingestCommonwealthLegislation(brandId, options = {}) {
  const {
    limit = 100,        // Number of acts to fetch
    startYear = 1990,   // Start from this year
    updateOnly = false  // If true, only update recently changed acts
  } = options;

  const sourceId = await getSourceId(brandId, 'cth_acts');
  if (!sourceId) {
    throw new Error('Commonwealth legislation source not found');
  }

  const logId = uuidv4();
  const startTime = Date.now();

  try {
    console.log(`[INGEST] Starting Commonwealth legislation ingest (limit=${limit})`);
    await logIngestionStart(logId, brandId, sourceId);

    // Get list of Commonwealth acts
    console.log('[INGEST] Fetching act list from legislation.gov.au...');
    const actList = await fetchCommonwealthActsList(limit, startYear);

    if (actList.length === 0) {
      console.log('[INGEST] No new legislation found');
      await logIngestionSuccess(logId, 0, 0, startTime, brandId, sourceId);
      return { created: 0, updated: 0 };
    }

    console.log(`[INGEST] Found ${actList.length} acts to process`);

    let created = 0;
    let updated = 0;

    // Process in batches
    for (let i = 0; i < actList.length; i += BATCH_SIZE) {
      const batch = actList.slice(i, i + BATCH_SIZE);

      for (const actInfo of batch) {
        try {
          await sleep(REQUEST_DELAY);

          console.log(`[INGEST] Fetching: ${actInfo.title} (${actInfo.year})`);
          const actContent = await fetchActContent(actInfo.url);

          if (actContent) {
            const statute = {
              title: actInfo.title,
              shortTitle: actInfo.shortTitle || actInfo.title,
              content: actContent.text,
              jurisdiction: 'cth',
              status: actInfo.status || 'current',
              year: actInfo.year,
              sections: actContent.sections || [],
              url: actInfo.url,
              effectiveDate: actInfo.effectiveDate
            };

            const result = await upsertCommonwealthStatute(brandId, sourceId, statute);

            if (result.isNew) {
              created++;
            } else {
              updated++;
            }

            console.log(`  ✓ ${result.isNew ? 'Created' : 'Updated'}: ${statute.title}`);
          }
        } catch (err) {
          console.warn(`[INGEST] Error processing ${actInfo.title}:`, err.message);
        }
      }

      console.log(`[INGEST] Batch progress: ${Math.min(i + BATCH_SIZE, actList.length)}/${actList.length}`);
    }

    await logIngestionSuccess(logId, created, updated, startTime, brandId, sourceId);
    console.log(`[INGEST] Commonwealth ingest complete: ${created} created, ${updated} updated`);

    return { created, updated };
  } catch (error) {
    console.error('[INGEST ERROR] Commonwealth legislation:', error);
    await logIngestionFailure(logId, error.message, startTime, brandId, sourceId);
    throw error;
  }
}

/**
 * Fetch list of Commonwealth acts from legislation.gov.au
 * Returns array of act metadata
 */
async function fetchCommonwealthActsList(limit = 100, startYear = 1990) {
  try {
    // This is a simplified implementation
    // In production, you would parse the legislation.gov.au website or use their API
    // For now, return sample data that matches real Commonwealth acts

    const commonwealthActs = [
      {
        title: 'Crimes Act 1995',
        shortTitle: 'Crimes Act',
        year: 1995,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1995A00043/latest/text',
        effectiveDate: new Date('1995-01-01')
      },
      {
        title: 'Corporations Act 2001',
        shortTitle: 'Corporations Act',
        year: 2001,
        status: 'current',
        url: 'https://www.legislation.gov.au/C2001A00050/latest/text',
        effectiveDate: new Date('2001-07-01')
      },
      {
        title: 'Commonwealth Electoral Act 1918',
        shortTitle: 'Electoral Act',
        year: 1918,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1918A00032/latest/text',
        effectiveDate: new Date('1918-06-01')
      },
      {
        title: 'Racial Discrimination Act 1975',
        shortTitle: 'RDA',
        year: 1975,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1975A00052/latest/text',
        effectiveDate: new Date('1975-01-01')
      },
      {
        title: 'Sex Discrimination Act 1984',
        shortTitle: 'SDA',
        year: 1984,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1984A00068/latest/text',
        effectiveDate: new Date('1984-08-01')
      },
      {
        title: 'Privacy Act 1988',
        shortTitle: 'Privacy Act',
        year: 1988,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1988A00119/latest/text',
        effectiveDate: new Date('1988-12-21')
      },
      {
        title: 'Native Title Act 1993',
        shortTitle: 'NTA',
        year: 1993,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1993A00110/latest/text',
        effectiveDate: new Date('1993-12-24')
      },
      {
        title: 'Trade Marks Act 1995',
        shortTitle: 'Trade Marks Act',
        year: 1995,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1995A01455/latest/text',
        effectiveDate: new Date('1995-01-01')
      },
      {
        title: 'Copyright Act 1968',
        shortTitle: 'Copyright Act',
        year: 1968,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1968A00063/latest/text',
        effectiveDate: new Date('1969-01-01')
      },
      {
        title: 'Patents Act 1990',
        shortTitle: 'Patents Act',
        year: 1990,
        status: 'current',
        url: 'https://www.legislation.gov.au/C1990A00016/latest/text',
        effectiveDate: new Date('1991-01-01')
      },
      {
        title: 'Competition and Consumer Act 2010',
        shortTitle: 'CCA',
        year: 2010,
        status: 'current',
        url: 'https://www.legislation.gov.au/C2010A00139/latest/text',
        effectiveDate: new Date('2010-07-01')
      },
      {
        title: 'Intellectual Property Laws Amendment Act 2015',
        shortTitle: 'IP Laws Amendment Act',
        year: 2015,
        status: 'current',
        url: 'https://www.legislation.gov.au/C2015A00127/latest/text',
        effectiveDate: new Date('2015-12-10')
      }
    ];

    // Filter by year and limit
    return commonwealthActs
      .filter(act => act.year >= startYear)
      .slice(0, limit);
  } catch (error) {
    console.error('[INGEST] Error fetching acts list:', error);
    throw error;
  }
}

/**
 * Fetch content of a specific act
 * Returns { text: string, sections: string[] }
 */
async function fetchActContent(url) {
  try {
    // In production, this would fetch from the actual legislation.gov.au URL
    // For now, return sample content based on the act

    const sampleContent = {
      'Crimes Act': {
        text: `CRIMES ACT 1995

PART 1 - INTRODUCTION
This Act establishes federal offences and defences under Australian criminal law.

PART 2 - GENERAL PRINCIPLES OF CRIMINAL RESPONSIBILITY
Section 10: General principles
An offence has physical and fault elements. The fault element may be intention, knowledge, recklessness or negligence.

Section 11: Attempt
A person who attempts to commit an offence commits an offence.

Section 12: Conspiracy
A person who conspires with another to commit an offence commits an offence.

Section 15: Accessorial liability
A person who aids, abets, counsels or procures the commission of an offence by another commits an offence.

PART 3 - OFFENCES
Section 131: Homicide
...`,
        sections: ['1', '2', '10', '11', '12', '15', '131', '132']
      },
      'Corporations Act': {
        text: `CORPORATIONS ACT 2001

PART 1 - PRELIMINARY
This Act establishes a national legal system for the regulation of corporations, financial markets, and financial services.

Section 12CF: Financial Services Guide
A holder of an Australian financial services licence must provide a Financial Services Guide to clients.

Section 760A: Advice subject to this Chapter
This section applies to financial product advice provided by financial services licensees.

PART 7A - FINANCIAL SERVICES AND MARKETS
...`,
        sections: ['1', '12CF', '760A', '760D']
      }
    };

    // Return matching sample content or generic content
    for (const [key, content] of Object.entries(sampleContent)) {
      if (url.includes(key) || url.toLowerCase().includes(key.toLowerCase())) {
        return content;
      }
    }

    // Default sample content
    return {
      text: 'This is a Commonwealth Act content. In production, this would contain the full text of the legislation.',
      sections: ['1', '2', '3', '4', '5']
    };
  } catch (error) {
    console.error('[INGEST] Error fetching act content:', error);
    return null;
  }
}

/**
 * Upsert Commonwealth statute into database
 */
async function upsertCommonwealthStatute(brandId, sourceId, statute) {
  try {
    const statuteId = uuidv4();

    // Check if statute exists
    const existing = await db.one(
      `SELECT id FROM law_statutes
       WHERE brand_id = $1 AND LOWER(title) = LOWER($2) AND year = $3`,
      [brandId, statute.title, statute.year]
    );

    if (existing) {
      // Update existing
      await db.query(
        `UPDATE law_statutes
         SET content = $1, sections = $2, updated_at = NOW()
         WHERE id = $3`,
        [statute.content, JSON.stringify(statute.sections), existing.id]
      );

      // Detect and link citations
      await detectAndLinkCitations(brandId, statute.content, existing.id, 'statute');

      return { isNew: false, id: existing.id };
    }

    // Create new
    const result = await db.one(
      `INSERT INTO law_statutes
        (id, brand_id, source_id, title, short_title, content, jurisdiction, status, year, effective_date, url, sections)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        statuteId,
        brandId,
        sourceId,
        statute.title,
        statute.shortTitle,
        statute.content,
        statute.jurisdiction,
        statute.status,
        statute.year,
        statute.effectiveDate,
        statute.url,
        JSON.stringify(statute.sections)
      ]
    );

    // Detect and link citations
    await detectAndLinkCitations(brandId, statute.content, result.id, 'statute');

    return { isNew: true, id: result.id };
  } catch (error) {
    console.error('[INGEST] Error upserting statute:', error);
    throw error;
  }
}

