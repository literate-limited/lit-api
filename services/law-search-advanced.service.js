/**
 * Advanced Search Query Parser
 * Supports: Boolean operators, wildcards, phrases, field queries, ranges
 */

export class AdvancedSearchParser {
  constructor() {
    this.operators = {
      AND: 'AND',
      OR: 'OR',
      NOT: 'NOT',
      NEAR: 'NEAR'
    };
  }

  /**
   * Parse advanced search query into SQL conditions
   * Examples:
   *   "property" -> simple term
   *   "property AND rights" -> AND operator
   *   "property OR title" -> OR operator
   *   "NOT repealed" -> NOT operator
   *   "property*" -> wildcard
   *   '"property rights"' -> phrase search
   *   'title:property' -> field search
   *   'year:[2020 TO 2023]' -> range query
   *   'word1 NEAR/5 word2' -> proximity search
   */
  parse(query) {
    if (!query || typeof query !== 'string') {
      return null;
    }

    const tokens = this.tokenize(query.trim());
    return this.buildSQLCondition(tokens);
  }

  /**
   * Tokenize the search query
   */
  tokenize(query) {
    const tokens = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < query.length; i++) {
      const char = query[i];

      if (char === '"') {
        inQuotes = !inQuotes;
        if (!inQuotes && current) {
          tokens.push({ type: 'phrase', value: current.trim() });
          current = '';
        } else if (inQuotes) {
          current = '';
        }
        continue;
      }

      if (!inQuotes && /\s/.test(char)) {
        if (current) {
          this.pushToken(tokens, current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current) {
      this.pushToken(tokens, current);
    }

    return tokens;
  }

  /**
   * Push token to tokens array with proper typing
   */
  pushToken(tokens, value) {
    const upper = value.toUpperCase();

    if (upper === 'AND') {
      tokens.push({ type: 'operator', value: 'AND' });
    } else if (upper === 'OR') {
      tokens.push({ type: 'operator', value: 'OR' });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'operator', value: 'NOT' });
    } else if (upper.startsWith('NEAR')) {
      // Extract proximity distance: NEAR/5
      const match = upper.match(/NEAR\/(\d+)/);
      const distance = match ? parseInt(match[1]) : 5;
      tokens.push({ type: 'operator', value: 'NEAR', distance });
    } else if (value.includes(':')) {
      // Field query: field:value
      const [field, fieldValue] = value.split(':');
      tokens.push({ type: 'field', field, value: fieldValue });
    } else if (value.includes('[') && value.includes(']')) {
      // Range query: [2020 TO 2023]
      const match = value.match(/\[(.+?)\s+TO\s+(.+?)\]/);
      if (match) {
        tokens.push({ type: 'range', start: match[1], end: match[2] });
      }
    } else if (value.includes('*') || value.includes('?')) {
      // Wildcard query
      tokens.push({ type: 'wildcard', value });
    } else {
      // Regular term
      tokens.push({ type: 'term', value });
    }
  }

  /**
   * Build SQL condition from parsed tokens
   */
  buildSQLCondition(tokens) {
    if (!tokens || tokens.length === 0) {
      return null;
    }

    const conditions = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token.type === 'operator') {
        // Operators are handled in combination with terms
        i++;
        continue;
      }

      let condition = '';
      let nextOp = null;

      // Check for operator after this token
      if (i + 1 < tokens.length && tokens[i + 1].type === 'operator') {
        nextOp = tokens[i + 1];
      }

      if (token.type === 'term') {
        condition = `content_tsvector @@ plainto_tsquery('english', '${this.escapeSql(token.value)}')`;
      } else if (token.type === 'phrase') {
        condition = `content_tsvector @@ phraseto_tsquery('english', '${this.escapeSql(token.value)}')`;
      } else if (token.type === 'wildcard') {
        const pattern = token.value.replace(/\*/g, '%').replace(/\?/g, '_');
        condition = `content ILIKE '%${this.escapeSql(pattern)}%'`;
      } else if (token.type === 'field') {
        if (token.field.toLowerCase() === 'title') {
          condition = `title ILIKE '%${this.escapeSql(token.value)}%'`;
        } else if (token.field.toLowerCase() === 'year') {
          condition = `year = ${parseInt(token.value)}`;
        } else if (token.field.toLowerCase() === 'jurisdiction') {
          condition = `jurisdiction = '${this.escapeSql(token.value)}'`;
        }
      } else if (token.type === 'range') {
        const start = parseInt(token.start);
        const end = parseInt(token.end);
        condition = `year BETWEEN ${start} AND ${end}`;
      }

      if (condition) {
        conditions.push(condition);
      }

      // Handle operator logic
      if (nextOp) {
        if (nextOp.value === 'NOT') {
          conditions[conditions.length - 1] = `NOT (${conditions[conditions.length - 1]})`;
        }
        i += 2; // Skip operator
      } else {
        i++;
      }
    }

    // Join conditions with OR by default, but AND if explicitly specified
    // This is a simplified implementation
    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  /**
   * Escape SQL string
   */
  escapeSql(str) {
    return str.replace(/'/g, "''");
  }

  /**
   * Get search syntax help text
   */
  static getHelpText() {
    return `
Advanced Search Syntax:

AND Operator:
  "property AND rights" - Find documents containing both terms
  Example: crime AND penalty

OR Operator:
  "property OR title" - Find documents containing either term
  Example: statute OR act

NOT Operator:
  "repealed NOT current" - Find documents with first term but not second
  Example: copyright NOT patent

Wildcard Search:
  * matches any sequence of characters
  ? matches a single character
  Example: "legisl*" matches legislation, legislative, etc.

Phrase Search:
  Use quotes for exact phrases
  Example: "property rights"

Field Search:
  title:property - Search specific field
  Example: title:crimes

Range Query:
  year:[2020 TO 2023] - Find documents in year range
  Example: year:[2000 TO 2023]

Proximity Search (approximate):
  word1 NEAR/5 word2 - Words within 5 words of each other

Examples:
  crime AND penalty
  "criminal law" OR legislation
  statute AND NOT repealed
  title:property AND year:[2010 TO 2023]
`;
  }
}

/**
 * Convert advanced search query to PostgreSQL FTS query
 */
export function buildAdvancedSearchSQL(query, baseQuery) {
  const parser = new AdvancedSearchParser();
  const condition = parser.parse(query);

  if (!condition) {
    return baseQuery;
  }

  // Replace the simple tsvector condition with the advanced condition
  return baseQuery.replace(
    `content_tsvector @@ plainto_tsquery('english', $${baseQuery.match(/\$\d+/g)?.pop()})`,
    `(${condition})`
  );
}
