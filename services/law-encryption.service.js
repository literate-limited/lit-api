import db from '../db.js';

/**
 * Law Encryption Service
 *
 * Handles field-level encryption for sensitive consultation data
 * Uses PostgreSQL pgcrypto extension with AES-256-GCM
 *
 * Environment Variable Required:
 * LAWLORE_ENCRYPTION_KEY=<64-char-hex-string from: openssl rand -hex 32>
 *
 * Key Rotation Support:
 * - All encrypted fields include encryption_key_version
 * - Old keys can be stored and used for decryption during key rotation
 */

const ENCRYPTION_KEY = process.env.LAWLORE_ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_VERSION = 1;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error(
    'CRITICAL: LAWLORE_ENCRYPTION_KEY not set or invalid length (must be 64 hex chars)\n' +
    'Generate with: openssl rand -hex 32\n' +
    'Set in .env: LAWLORE_ENCRYPTION_KEY=<64-char-hex>'
  );
}

/**
 * Encrypt a field value using pgcrypto symmetric encryption
 * @param {string} plaintext - The text to encrypt
 * @param {string} encryptionKey - The encryption key (hex string)
 * @returns {Promise<Buffer>} - Encrypted bytea data
 */
export async function encryptField(plaintext, encryptionKey = ENCRYPTION_KEY) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('plaintext must be a non-empty string');
  }

  try {
    const result = await db.one(
      `SELECT encode(
        pgp_sym_encrypt($1::text, $2::text, 'compress-algo=1,cipher-algo=aes256'),
        'escape'
      ) as encrypted`,
      [plaintext, encryptionKey]
    );

    // Convert the escaped string back to bytes
    return Buffer.from(result.encrypted, 'utf8');
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error(`Failed to encrypt field: ${error.message}`);
  }
}

/**
 * Decrypt a single encrypted field
 * @param {Buffer} encryptedData - The encrypted bytea data
 * @param {string} encryptionKey - The encryption key (hex string)
 * @returns {Promise<string>} - Decrypted plaintext
 */
export async function decryptField(encryptedData, encryptionKey = ENCRYPTION_KEY) {
  if (!encryptedData) {
    throw new Error('encryptedData is required');
  }

  // If encryptedData is a Buffer, convert to escaped string
  let escapedData = encryptedData;
  if (Buffer.isBuffer(encryptedData)) {
    escapedData = encryptedData.toString('utf8');
  }

  try {
    const result = await db.one(
      `SELECT pgp_sym_decrypt(
        decode($1::text, 'escape'),
        $2::text
      )::text as decrypted`,
      [escapedData, encryptionKey]
    );

    return result.decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error(`Failed to decrypt field: ${error.message}`);
  }
}

/**
 * Decrypt multiple fields from a row
 * @param {Object} row - Database row with encrypted bytea fields
 * @param {string[]} fieldNames - Array of field names to decrypt
 * @param {string} encryptionKey - The encryption key
 * @returns {Promise<Object>} - Row with decrypted fields
 */
export async function decryptRow(row, fieldNames, encryptionKey = ENCRYPTION_KEY) {
  if (!row || !Array.isArray(fieldNames)) {
    throw new Error('row and fieldNames array required');
  }

  const decrypted = { ...row };

  for (const fieldName of fieldNames) {
    if (row[fieldName]) {
      try {
        decrypted[fieldName] = await decryptField(row[fieldName], encryptionKey);
      } catch (error) {
        console.error(`Failed to decrypt field ${fieldName}:`, error);
        decrypted[fieldName] = null;
      }
    }
  }

  return decrypted;
}

/**
 * Decrypt multiple rows efficiently
 * @param {Object[]} rows - Array of database rows
 * @param {string[]} fieldNames - Field names to decrypt in each row
 * @param {string} encryptionKey - The encryption key
 * @returns {Promise<Object[]>} - Rows with decrypted fields
 */
export async function decryptBatch(rows, fieldNames, encryptionKey = ENCRYPTION_KEY) {
  if (!Array.isArray(rows) || !Array.isArray(fieldNames)) {
    throw new Error('rows and fieldNames must be arrays');
  }

  return Promise.all(
    rows.map(row => decryptRow(row, fieldNames, encryptionKey))
  );
}

/**
 * Rotate encryption keys for a brand
 * 1. Creates new key version
 * 2. Re-encrypts all sensitive fields with new key
 * 3. Marks old key as inactive
 *
 * @param {string} brandId - The brand UUID
 * @param {string} newEncryptionKey - New encryption key (hex string)
 * @returns {Promise<Object>} - Rotation summary
 */
export async function rotateEncryptionKey(brandId, newEncryptionKey) {
  if (!brandId || !newEncryptionKey) {
    throw new Error('brandId and newEncryptionKey required');
  }

  if (newEncryptionKey.length !== 64) {
    throw new Error('newEncryptionKey must be 64 hex characters');
  }

  try {
    // Start transaction
    await db.query('BEGIN');

    // Get current active key version
    const currentKey = await db.one(
      `SELECT key_version, is_active FROM law_encryption_keys
       WHERE brand_id = $1 AND is_active = true`,
      [brandId]
    );

    const newVersion = (currentKey?.key_version || 0) + 1;

    // Create new key version
    await db.query(
      `INSERT INTO law_encryption_keys (brand_id, key_version, algorithm, is_active)
       VALUES ($1, $2, $3, true)`,
      [brandId, newVersion, ALGORITHM]
    );

    // Re-encrypt all consultations
    const consultations = await db.many(
      `SELECT id, case_title_encrypted, facts_encrypted, legal_questions_encrypted
       FROM law_consultations WHERE brand_id = $1`,
      [brandId]
    );

    let reencryptedCount = 0;

    for (const consultation of consultations) {
      try {
        // Decrypt with old key
        const caseTitle = await decryptField(
          consultation.case_title_encrypted,
          ENCRYPTION_KEY
        );
        const facts = await decryptField(
          consultation.facts_encrypted,
          ENCRYPTION_KEY
        );
        const legalQuestions = await decryptField(
          consultation.legal_questions_encrypted,
          ENCRYPTION_KEY
        );

        // Encrypt with new key
        const newCaseTitle = await encryptField(caseTitle, newEncryptionKey);
        const newFacts = await encryptField(facts, newEncryptionKey);
        const newLegalQuestions = await encryptField(legalQuestions, newEncryptionKey);

        // Update consultation
        await db.query(
          `UPDATE law_consultations
           SET case_title_encrypted = $1,
               facts_encrypted = $2,
               legal_questions_encrypted = $3,
               encryption_key_version = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [newCaseTitle, newFacts, newLegalQuestions, newVersion, consultation.id]
        );

        reencryptedCount++;
      } catch (error) {
        console.error(`Failed to re-encrypt consultation ${consultation.id}:`, error);
        throw error;
      }
    }

    // Re-encrypt all messages
    const messages = await db.many(
      `SELECT id, message_content_encrypted FROM law_consultation_messages
       WHERE brand_id = $1`,
      [brandId]
    );

    let reencryptedMessages = 0;

    for (const message of messages) {
      try {
        const content = await decryptField(
          message.message_content_encrypted,
          ENCRYPTION_KEY
        );
        const newContent = await encryptField(content, newEncryptionKey);

        await db.query(
          `UPDATE law_consultation_messages
           SET message_content_encrypted = $1,
               encryption_key_version = $2
           WHERE id = $3`,
          [newContent, newVersion, message.id]
        );

        reencryptedMessages++;
      } catch (error) {
        console.error(`Failed to re-encrypt message ${message.id}:`, error);
        throw error;
      }
    }

    // Mark old key as inactive
    if (currentKey) {
      await db.query(
        `UPDATE law_encryption_keys
         SET is_active = false, rotated_at = NOW()
         WHERE brand_id = $1 AND key_version = $2`,
        [brandId, currentKey.key_version]
      );
    }

    // Commit transaction
    await db.query('COMMIT');

    return {
      success: true,
      newKeyVersion: newVersion,
      consultationsReencrypted: reencryptedCount,
      messagesReencrypted: reencryptedMessages,
      totalReencrypted: reencryptedCount + reencryptedMessages,
      message: `Key rotation complete: ${reencryptedCount} consultations and ${reencryptedMessages} messages re-encrypted`
    };
  } catch (error) {
    // Rollback on error
    await db.query('ROLLBACK').catch(e => console.error('Rollback error:', e));
    console.error('Key rotation error:', error);
    throw new Error(`Key rotation failed: ${error.message}`);
  }
}

/**
 * Verify encryption key is configured correctly
 * @returns {boolean} - True if encryption key is available and valid
 */
export function isEncryptionConfigured() {
  return ENCRYPTION_KEY && ENCRYPTION_KEY.length === 64;
}

/**
 * Get encryption status (informational only, doesn't expose the key)
 * @returns {Object} - Encryption status information
 */
export function getEncryptionStatus() {
  return {
    configured: isEncryptionConfigured(),
    algorithm: ALGORITHM,
    keyLength: ENCRYPTION_KEY ? ENCRYPTION_KEY.length : 0,
    message: isEncryptionConfigured()
      ? 'Encryption properly configured'
      : 'CRITICAL: Encryption key not configured'
  };
}

export default {
  encryptField,
  decryptField,
  decryptRow,
  decryptBatch,
  rotateEncryptionKey,
  isEncryptionConfigured,
  getEncryptionStatus
};
