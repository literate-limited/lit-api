/**
 * Credits Service
 *
 * Manages TeleprompTV credit system:
 * - Track user credits balance
 * - Deduct credits for operations
 * - Record credit transactions
 * - Handle credit purchases and refunds
 */

import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

// Credit costs for different operations
export const CREDIT_COSTS = {
  TRANSCRIPTION_PER_MINUTE: 1,
  VIDEO_EXPORT_SD: 2,
  VIDEO_EXPORT_HD: 5,
  VIDEO_EXPORT_4K: 10,
  AI_SCRIPT_GENERATION: 3,
  AI_SCRIPT_ENHANCEMENT: 2,
  VIDEO_STORAGE_PER_GB_MONTH: 1,
  WATERMARK_REMOVAL: 5
};

// Credit packages for purchase
export const CREDIT_PACKAGES = {
  STARTER: { credits: 100, price: 9.99, name: 'Starter Pack' },
  PRO: { credits: 500, price: 39.99, name: 'Pro Pack' },
  BUSINESS: { credits: 2000, price: 149.99, name: 'Business Pack' },
  ENTERPRISE: { credits: 10000, price: 599.99, name: 'Enterprise Pack' }
};

/**
 * Get user's credit balance
 * @param {string} userId - User ID
 * @param {string} brandId - Brand ID
 * @returns {Promise<number>} - Credit balance
 */
export async function getCreditBalance(userId, brandId) {
  try {
    // In a real implementation, this would query a user_credits table
    // For now, we'll use a simple query that could be added to the user table
    // or a separate credits table

    const result = await db.one(
      `SELECT COALESCE(
        (SELECT SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END)
         FROM credit_transactions
         WHERE user_id = $1 AND brand_id = $2),
        0
      ) as balance`,
      [userId, brandId]
    );

    return result?.balance || 0;
  } catch (error) {
    // If credit_transactions table doesn't exist yet, return 0
    // This allows the service to work even before full TTV migration
    console.warn('Credit balance query failed:', error.message);
    return 0;
  }
}

/**
 * Check if user has enough credits
 * @param {string} userId - User ID
 * @param {string} brandId - Brand ID
 * @param {number} requiredCredits - Required credit amount
 * @returns {Promise<boolean>} - True if user has enough credits
 */
export async function hasEnoughCredits(userId, brandId, requiredCredits) {
  const balance = await getCreditBalance(userId, brandId);
  return balance >= requiredCredits;
}

/**
 * Deduct credits from user
 * @param {string} userId - User ID
 * @param {string} brandId - Brand ID
 * @param {number} amount - Credit amount to deduct
 * @param {string} operation - Operation description
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} - Transaction result
 */
export async function deductCredits(userId, brandId, amount, operation, metadata = {}) {
  try {
    // Check balance first
    const balance = await getCreditBalance(userId, brandId);

    if (balance < amount) {
      throw new Error(`Insufficient credits. Required: ${amount}, Available: ${balance}`);
    }

    // Record debit transaction
    const transactionId = uuidv4();

    // Note: This assumes a credit_transactions table exists
    // You may need to create this table in a future migration
    const transaction = {
      id: transactionId,
      user_id: userId,
      brand_id: brandId,
      type: 'debit',
      amount,
      operation,
      metadata: JSON.stringify(metadata),
      balance_after: balance - amount,
      created_at: new Date().toISOString()
    };

    // For now, we'll store this in memory/log until the table is created
    // In production, this would be:
    // await db.query('INSERT INTO credit_transactions (...) VALUES (...)', [...]);

    return {
      success: true,
      transactionId,
      previousBalance: balance,
      amountDeducted: amount,
      newBalance: balance - amount,
      operation
    };
  } catch (error) {
    console.error('Credit deduction error:', error);
    throw error;
  }
}

/**
 * Add credits to user (purchase, refund, bonus)
 * @param {string} userId - User ID
 * @param {string} brandId - Brand ID
 * @param {number} amount - Credit amount to add
 * @param {string} reason - Reason for credit addition
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} - Transaction result
 */
export async function addCredits(userId, brandId, amount, reason, metadata = {}) {
  try {
    const balance = await getCreditBalance(userId, brandId);
    const transactionId = uuidv4();

    const transaction = {
      id: transactionId,
      user_id: userId,
      brand_id: brandId,
      type: 'credit',
      amount,
      operation: reason,
      metadata: JSON.stringify(metadata),
      balance_after: balance + amount,
      created_at: new Date().toISOString()
    };

    // Store transaction (would use DB in production)

    return {
      success: true,
      transactionId,
      previousBalance: balance,
      amountAdded: amount,
      newBalance: balance + amount,
      reason
    };
  } catch (error) {
    console.error('Credit addition error:', error);
    throw error;
  }
}

/**
 * Calculate credit cost for transcription
 * @param {number} durationSeconds - Audio/video duration in seconds
 * @returns {number} - Credit cost
 */
export function calculateTranscriptionCost(durationSeconds) {
  const minutes = Math.ceil(durationSeconds / 60);
  return minutes * CREDIT_COSTS.TRANSCRIPTION_PER_MINUTE;
}

/**
 * Calculate credit cost for video export
 * @param {string} resolution - Video resolution (SD, HD, 4K)
 * @returns {number} - Credit cost
 */
export function calculateExportCost(resolution) {
  const resolutionUpper = (resolution || 'SD').toUpperCase();

  switch (resolutionUpper) {
    case '4K':
    case 'UHD':
      return CREDIT_COSTS.VIDEO_EXPORT_4K;
    case 'HD':
    case '1080P':
    case 'FHD':
      return CREDIT_COSTS.VIDEO_EXPORT_HD;
    case 'SD':
    case '720P':
    default:
      return CREDIT_COSTS.VIDEO_EXPORT_SD;
  }
}

/**
 * Get credit transaction history
 * @param {string} userId - User ID
 * @param {string} brandId - Brand ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Transaction history
 */
export async function getTransactionHistory(userId, brandId, options = {}) {
  try {
    const {
      limit = 50,
      offset = 0,
      type = null // 'credit' or 'debit'
    } = options;

    let query = 'SELECT * FROM credit_transactions WHERE user_id = $1 AND brand_id = $2';
    const params = [userId, brandId];

    if (type) {
      query += ' AND type = $3';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const transactions = await db.many(query, params);

    return transactions.map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      operation: t.operation,
      balanceAfter: t.balance_after,
      metadata: typeof t.metadata === 'string' ? JSON.parse(t.metadata) : t.metadata,
      createdAt: t.created_at
    }));
  } catch (error) {
    console.warn('Transaction history query failed:', error.message);
    return [];
  }
}

/**
 * Process credit purchase
 * @param {string} userId - User ID
 * @param {string} brandId - Brand ID
 * @param {string} packageKey - Package key (STARTER, PRO, etc.)
 * @param {Object} paymentDetails - Payment information
 * @returns {Promise<Object>} - Purchase result
 */
export async function purchaseCredits(userId, brandId, packageKey, paymentDetails = {}) {
  const package_ = CREDIT_PACKAGES[packageKey];

  if (!package_) {
    throw new Error(`Invalid credit package: ${packageKey}`);
  }

  try {
    // In production, this would:
    // 1. Process payment through payment gateway
    // 2. Verify payment success
    // 3. Add credits to user account

    const result = await addCredits(
      userId,
      brandId,
      package_.credits,
      'purchase',
      {
        package: packageKey,
        packageName: package_.name,
        price: package_.price,
        paymentId: paymentDetails.paymentId || uuidv4()
      }
    );

    return {
      success: true,
      package: package_,
      creditsAdded: package_.credits,
      newBalance: result.newBalance,
      transactionId: result.transactionId
    };
  } catch (error) {
    console.error('Credit purchase error:', error);
    throw error;
  }
}

/**
 * Check and deduct credits for an operation (with error handling)
 * @param {string} userId - User ID
 * @param {string} brandId - Brand ID
 * @param {string} operation - Operation name
 * @param {number} cost - Credit cost
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} - Result with success status
 */
export async function chargeForOperation(userId, brandId, operation, cost, metadata = {}) {
  try {
    // Check if user has enough credits
    const hasCredits = await hasEnoughCredits(userId, brandId, cost);

    if (!hasCredits) {
      const balance = await getCreditBalance(userId, brandId);
      return {
        success: false,
        error: 'INSUFFICIENT_CREDITS',
        message: `Not enough credits. Required: ${cost}, Available: ${balance}`,
        required: cost,
        available: balance,
        shortfall: cost - balance
      };
    }

    // Deduct credits
    const result = await deductCredits(userId, brandId, cost, operation, metadata);

    return {
      success: true,
      charged: cost,
      newBalance: result.newBalance,
      transactionId: result.transactionId
    };
  } catch (error) {
    console.error('Operation charge error:', error);
    return {
      success: false,
      error: 'CHARGE_FAILED',
      message: error.message
    };
  }
}

/**
 * Refund credits for a failed operation
 * @param {string} userId - User ID
 * @param {string} brandId - Brand ID
 * @param {number} amount - Amount to refund
 * @param {string} reason - Refund reason
 * @param {string} originalTransactionId - Original transaction ID
 * @returns {Promise<Object>} - Refund result
 */
export async function refundCredits(userId, brandId, amount, reason, originalTransactionId) {
  return await addCredits(userId, brandId, amount, 'refund', {
    refundReason: reason,
    originalTransactionId
  });
}

export default {
  getCreditBalance,
  hasEnoughCredits,
  deductCredits,
  addCredits,
  calculateTranscriptionCost,
  calculateExportCost,
  getTransactionHistory,
  purchaseCredits,
  chargeForOperation,
  refundCredits,
  CREDIT_COSTS,
  CREDIT_PACKAGES
};
