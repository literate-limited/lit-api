import fetch from 'node-fetch';
import db from '../db.js';

/**
 * Law Claude AI Service
 *
 * Integrates Claude API for AI-powered legal research
 * Enforces Australian legal context, AGLC citations, and source transparency
 *
 * Environment Variables Required:
 * ANTHROPIC_API_KEY=<your-anthropic-api-key>
 * CLAUDE_MODEL=claude-opus-4-6 (or claude-sonnet-4-5-20250929)
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-6';
const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';

if (!ANTHROPIC_API_KEY) {
  console.error('CRITICAL: ANTHROPIC_API_KEY not set in environment');
}

/**
 * Generate a legal response from Claude with citations
 * @param {Object} consultation - Consultation object with encrypted fields
 * @param {Array} conversationHistory - Previous messages in this consultation
 * @param {string} userMessage - The user's latest message
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} - AI response with citations
 */
export async function generateLegalResponse(
  consultation,
  conversationHistory,
  userMessage,
  options = {}
) {
  const {
    temperature = 0.5, // Lower temperature for legal accuracy
    maxTokens = 2048
  } = options;

  if (!consultation || !userMessage) {
    throw new Error('consultation and userMessage required');
  }

  try {
    // Build context from conversation history
    const conversationContext = buildConversationContext(conversationHistory);

    // Build legal system prompt with Australian law context
    const systemPrompt = buildSystemPrompt(consultation);

    // Create messages array for Claude
    const messages = [
      ...conversationContext,
      {
        role: 'user',
        content: userMessage
      }
    ];

    // Call Claude API
    const response = await callClaudeApi({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages
    });

    // Extract response text
    const responseText = response.content[0].text;

    // Extract citations from response
    const citations = extractCitations(responseText, consultation.jurisdiction);

    // Return structured response
    return {
      responseText,
      citations,
      model: CLAUDE_MODEL,
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      costUsd: calculateCost(response.usage.input_tokens, response.usage.output_tokens),
      metadata: {
        stopReason: response.stop_reason,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Claude API error:', error);
    throw new Error(`Failed to generate legal response: ${error.message}`);
  }
}

/**
 * Call the Anthropic Claude API
 * @param {Object} params - Request parameters
 * @returns {Promise<Object>} - API response
 */
async function callClaudeApi(params) {
  const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

/**
 * Build the system prompt for legal analysis
 * Enforces Australian legal context and citation requirements
 * @param {Object} consultation - Consultation with case details
 * @returns {string} - System prompt for Claude
 */
function buildSystemPrompt(consultation) {
  const jurisdictionName = getJurisdictionName(consultation.jurisdiction);
  const caseTypeName = getCaseTypeName(consultation.case_type);

  return `You are an AI legal research assistant specializing in Australian law. Your role is to help users understand their legal situation and research relevant statutes and case law.

## CRITICAL REQUIREMENTS

1. **Jurisdiction**: You are providing advice for ${jurisdictionName}, governed by Australian legal frameworks.

2. **Citation Format**: All legal sources MUST be cited in AGLC (Australian Guide to Legal Citation) format:
   - Statutes: "Act Name Year (Jurisdiction) s XX" (e.g., "Fair Work Act 2009 (Cth) s 123")
   - Cases: "Case Name [Year] Court Abbrev Citation" (e.g., "Smith v Jones [2023] HCA 12")

3. **Case Type**: This matter concerns ${caseTypeName} law.

4. **Source Transparency**:
   - Every claim must be backed by a citation
   - Clearly distinguish between settled law and legal principles
   - Never make unsupported assertions
   - If uncertain about a source, say "the law may provide..." rather than stating as fact

5. **Legal Disclaimer**: Every response MUST include a clear disclaimer that this is NOT legal advice and the user should consult an actual lawyer.

6. **No Personal Legal Advice**: You cannot provide personalized legal advice. Instead:
   - Explain the legal framework that may apply
   - Point to relevant statutes and case law
   - Suggest areas for further research
   - Recommend consulting a qualified lawyer for their specific situation

7. **Accuracy First**: It's better to say "I don't know" than to guess about Australian law.

8. **Plain English**: Explain legal concepts clearly. Assume the user may not have legal training.

## RESPONSE STRUCTURE

For each response:
1. Answer the user's question based on relevant Australian law
2. Cite all legal sources (statutes, cases) in AGLC format
3. Include disclaimer about not being legal advice
4. Suggest next steps or additional areas to research
5. If appropriate, note where the law differs between jurisdictions

Remember: Your role is legal research and education, not legal advice.`;
}

/**
 * Build conversation context from previous messages
 * @param {Array} history - Previous messages
 * @returns {Array} - Formatted message array for Claude
 */
function buildConversationContext(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  return history.map(msg => ({
    role: msg.sender_type === 'ai' ? 'assistant' : 'user',
    content: msg.content || msg.message_content || ''
  }));
}

/**
 * Extract citations from AI response text
 * Parses AGLC format citations and matches them to database records
 * @param {string} responseText - The AI-generated response
 * @param {string} jurisdiction - The jurisdiction code
 * @returns {Promise<Array>} - Array of citation objects
 */
async function extractCitations(responseText, jurisdiction) {
  try {
    // Regex patterns for AGLC citations
    const patterns = {
      // Statutes: "Act Name Year (Jurisdiction) s XX"
      statute: /([A-Za-z\s&]+\d{4})\s*\(([A-Za-z]{1,3})\)\s*s\s*(\d+(?:\.\d+)?)/g,
      // Cases: "Case Name [Year] Court Citation"
      case: /([A-Z][a-z\s&v]+)\s*\[\d{4}\]\s*([A-Z]{2,4})\s+(\d+)/g
    };

    const citations = [];
    const processedTexts = new Set();

    // Extract statute citations
    let match;
    while ((match = patterns.statute.exec(responseText)) !== null) {
      const citationText = match[0];
      if (!processedTexts.has(citationText)) {
        processedTexts.add(citationText);
        citations.push({
          type: 'statute',
          citationText,
          actName: match[1].trim(),
          jurisdictionCode: match[2],
          section: match[3]
        });
      }
    }

    // Extract case citations
    while ((match = patterns.case.exec(responseText)) !== null) {
      const citationText = match[0];
      if (!processedTexts.has(citationText)) {
        processedTexts.add(citationText);
        citations.push({
          type: 'case',
          citationText,
          caseName: match[1].trim(),
          court: match[2],
          reporterNumber: match[3]
        });
      }
    }

    // Match citations to database records (async)
    const matchedCitations = await matchCitationsToDatabase(citations, jurisdiction);

    return matchedCitations;
  } catch (error) {
    console.error('Error extracting citations:', error);
    return []; // Return empty array if extraction fails
  }
}

/**
 * Match extracted citations to law_statutes and law_cases tables
 * @param {Array} citations - Extracted citations
 * @param {string} jurisdiction - Jurisdiction code
 * @returns {Promise<Array>} - Citations with matched database IDs
 */
async function matchCitationsToDatabase(citations, jurisdiction) {
  const matched = [];

  for (const citation of citations) {
    try {
      if (citation.type === 'statute') {
        // Try to find matching statute
        const statute = await db.oneOrNone(
          `SELECT id, title, short_title FROM law_statutes
           WHERE jurisdiction = $1
             AND (title ILIKE $2 OR short_title ILIKE $2)
           LIMIT 1`,
          [jurisdiction, `%${citation.actName}%`]
        );

        if (statute) {
          matched.push({
            ...citation,
            sourceStatuteId: statute.id,
            sourceTitle: statute.title
          });
        } else {
          // Keep unmatched citation with warning
          matched.push({
            ...citation,
            sourceStatuteId: null,
            warning: 'Statute not found in database'
          });
        }
      } else if (citation.type === 'case') {
        // Try to find matching case
        const caseRecord = await db.oneOrNone(
          `SELECT id, title, citation FROM law_cases
           WHERE jurisdiction = $1 AND (citation ILIKE $2 OR title ILIKE $3)
           LIMIT 1`,
          [jurisdiction, `%${citation.citationText}%`, `%${citation.caseName}%`]
        );

        if (caseRecord) {
          matched.push({
            ...citation,
            sourceCaseId: caseRecord.id,
            sourceTitle: caseRecord.title
          });
        } else {
          matched.push({
            ...citation,
            sourceCaseId: null,
            warning: 'Case not found in database'
          });
        }
      }
    } catch (error) {
      console.error(`Error matching citation ${citation.citationText}:`, error);
      matched.push({
        ...citation,
        error: 'Failed to match citation to database'
      });
    }
  }

  return matched;
}

/**
 * Calculate API cost based on tokens used
 * Uses Claude pricing (as of Feb 2025)
 * @param {number} inputTokens - Input tokens used
 * @param {number} outputTokens - Output tokens generated
 * @returns {number} - Cost in USD
 */
function calculateCost(inputTokens, outputTokens) {
  // Claude Opus 4.6 pricing (as of 2025)
  // Input: $15 per 1M tokens
  // Output: $45 per 1M tokens
  const inputCost = (inputTokens / 1_000_000) * 15;
  const outputCost = (outputTokens / 1_000_000) * 45;
  return inputCost + outputCost;
}

/**
 * Get human-readable jurisdiction name
 * @param {string} code - Jurisdiction code
 * @returns {string} - Full jurisdiction name
 */
function getJurisdictionName(code) {
  const jurisdictions = {
    cth: 'Commonwealth',
    nsw: 'New South Wales',
    vic: 'Victoria',
    qld: 'Queensland',
    sa: 'South Australia',
    wa: 'Western Australia',
    tas: 'Tasmania',
    nt: 'Northern Territory',
    act: 'Australian Capital Territory'
  };
  return jurisdictions[code] || code;
}

/**
 * Get human-readable case type name
 * @param {string} type - Case type code
 * @returns {string} - Full case type name
 */
function getCaseTypeName(type) {
  const types = {
    criminal: 'Criminal',
    civil: 'Civil',
    family: 'Family',
    employment: 'Employment',
    commercial: 'Commercial',
    property: 'Property',
    administrative: 'Administrative',
    constitutional: 'Constitutional',
    other: 'Other'
  };
  return types[type] || type;
}

/**
 * Validate that Claude can be used (API key configured)
 * @returns {boolean} - True if Claude is available
 */
export function isClaudeAvailable() {
  return !!ANTHROPIC_API_KEY;
}

/**
 * Get Claude service status
 * @returns {Object} - Status information
 */
export function getClaudeStatus() {
  return {
    available: isClaudeAvailable(),
    model: CLAUDE_MODEL,
    message: isClaudeAvailable()
      ? 'Claude API available'
      : 'CRITICAL: ANTHROPIC_API_KEY not configured'
  };
}

export default {
  generateLegalResponse,
  extractCitations,
  isClaudeAvailable,
  getClaudeStatus
};
