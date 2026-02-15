/**
 * Base Data Access Layer (Repository Pattern)
 * Provides common CRUD operations for all DAL classes
 */

const { NotFoundError } = require('../errors/AppError');

class BaseDAL {
  constructor(db, tableName) {
    if (!db) throw new Error('Database connection required');
    if (!tableName) throw new Error('Table name required');

    this.db = db;
    this.tableName = tableName;
  }

  /**
   * Find record by ID (single record, brand-isolated)
   */
  async findById(id, brandId) {
    return this.db.oneOrNone(
      `SELECT * FROM ${this.tableName} WHERE id = $1 AND brand_id = $2`,
      [id, brandId]
    );
  }

  /**
   * Find many records with filters
   */
  async findMany(filter = {}, brandId, options = {}) {
    const { limit = 20, offset = 0, orderBy = 'created_at', orderDir = 'DESC' } = options;

    // Build WHERE clause
    const whereClauses = ['brand_id = $1'];
    const values = [brandId];
    let paramIndex = 2;

    Object.entries(filter).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        whereClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    const whereClause = whereClauses.join(' AND ');

    // Get rows
    const rows = await this.db.many(
      `SELECT * FROM ${this.tableName}
       WHERE ${whereClause}
       ORDER BY ${orderBy} ${orderDir}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, limit, offset]
    );

    // Get total count
    const countResult = await this.db.one(
      `SELECT COUNT(*) as total FROM ${this.tableName} WHERE ${whereClause}`,
      values
    );

    return {
      rows,
      total: parseInt(countResult.total, 10),
      limit,
      offset,
      hasMore: offset + limit < parseInt(countResult.total, 10)
    };
  }

  /**
   * Find one record
   */
  async findOne(filter = {}, brandId) {
    const whereClauses = ['brand_id = $1'];
    const values = [brandId];
    let paramIndex = 2;

    Object.entries(filter).forEach(([key, value]) => {
      if (value !== undefined) {
        whereClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    const whereClause = whereClauses.join(' AND ');

    return this.db.oneOrNone(
      `SELECT * FROM ${this.tableName} WHERE ${whereClause}`,
      values
    );
  }

  /**
   * Create new record
   */
  async create(data, brandId) {
    const fields = ['brand_id', ...Object.keys(data)];
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
    const values = [brandId, ...Object.values(data)];

    return this.db.one(
      `INSERT INTO ${this.tableName} (${fields.join(', ')})
       VALUES (${placeholders})
       RETURNING *`,
      values
    );
  }

  /**
   * Update record
   */
  async update(id, updates, brandId) {
    if (Object.keys(updates).length === 0) {
      return this.findById(id, brandId);
    }

    const sets = Object.keys(updates)
      .map((key, i) => `${key} = $${i + 3}`)
      .join(', ');

    const values = [id, brandId, ...Object.values(updates)];

    return this.db.one(
      `UPDATE ${this.tableName}
       SET ${sets}, updated_at = NOW()
       WHERE id = $1 AND brand_id = $2
       RETURNING *`,
      values
    );
  }

  /**
   * Delete record (soft or hard)
   */
  async delete(id, brandId, soft = true) {
    if (soft) {
      return this.db.one(
        `UPDATE ${this.tableName}
         SET deleted_at = NOW()
         WHERE id = $1 AND brand_id = $2
         RETURNING *`,
        [id, brandId]
      );
    }

    return this.db.oneOrNone(
      `DELETE FROM ${this.tableName}
       WHERE id = $1 AND brand_id = $2
       RETURNING *`,
      [id, brandId]
    );
  }

  /**
   * Delete many records by filter
   */
  async deleteMany(filter = {}, brandId, soft = true) {
    const whereClauses = ['brand_id = $1'];
    const values = [brandId];
    let paramIndex = 2;

    Object.entries(filter).forEach(([key, value]) => {
      if (value !== undefined) {
        whereClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    const whereClause = whereClauses.join(' AND ');

    if (soft) {
      return this.db.many(
        `UPDATE ${this.tableName}
         SET deleted_at = NOW()
         WHERE ${whereClause}
         RETURNING *`,
        values
      );
    }

    return this.db.many(
      `DELETE FROM ${this.tableName}
       WHERE ${whereClause}
       RETURNING *`,
      values
    );
  }

  /**
   * Count records
   */
  async count(filter = {}, brandId) {
    const whereClauses = ['brand_id = $1'];
    const values = [brandId];
    let paramIndex = 2;

    Object.entries(filter).forEach(([key, value]) => {
      if (value !== undefined) {
        whereClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    const whereClause = whereClauses.join(' AND ');
    const result = await this.db.one(
      `SELECT COUNT(*) as total FROM ${this.tableName} WHERE ${whereClause}`,
      values
    );

    return parseInt(result.total, 10);
  }

  /**
   * Check if record exists
   */
  async exists(filter = {}, brandId) {
    const record = await this.findOne(filter, brandId);
    return !!record;
  }

  /**
   * Bulk create
   */
  async createMany(dataArray, brandId) {
    if (!dataArray.length) return [];

    const fields = ['brand_id', ...Object.keys(dataArray[0])];
    const placeholders = dataArray
      .map((_, rowIndex) => {
        const rowPlaceholders = fields
          .map((_, colIndex) => `$${rowIndex * fields.length + colIndex + 1}`)
          .join(', ');
        return `(${rowPlaceholders})`;
      })
      .join(', ');

    const values = dataArray.flatMap(item => [
      brandId,
      ...Object.values(item)
    ]);

    return this.db.many(
      `INSERT INTO ${this.tableName} (${fields.join(', ')})
       VALUES ${placeholders}
       RETURNING *`,
      values
    );
  }

  /**
   * Execute raw query (for complex queries)
   */
  async query(sql, params = []) {
    return this.db.query(sql, params);
  }
}

module.exports = BaseDAL;
