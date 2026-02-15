/**
 * Credits Service Unit Tests
 * Tests for the credit management system
 */

import { jest } from '@jest/globals';

// Mock database
const mockDb = {
  one: jest.fn(),
  query: jest.fn()
};

jest.unstable_mockModule('../../db.js', () => ({
  __esModule: true,
  default: mockDb
}));

const {
  getCreditBalance,
  hasEnoughCredits,
  deductCredits,
  addCredits,
  getCreditHistory,
  chargeForOperation,
  CREDIT_COSTS,
  CREDIT_PACKAGES
} = await import('../../services/credits.service.js');

describe('Credits Service', () => {
  const userId = 'user-123';
  const brandId = 'brand-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CREDIT_COSTS', () => {
    it('should have defined costs for all operations', () => {
      expect(CREDIT_COSTS.TRANSCRIPTION_PER_MINUTE).toBeDefined();
      expect(CREDIT_COSTS.VIDEO_EXPORT_SD).toBeDefined();
      expect(CREDIT_COSTS.VIDEO_EXPORT_HD).toBeDefined();
      expect(CREDIT_COSTS.VIDEO_EXPORT_4K).toBeDefined();
      expect(CREDIT_COSTS.AI_SCRIPT_GENERATION).toBeDefined();
      expect(CREDIT_COSTS.AI_SCRIPT_ENHANCEMENT).toBeDefined();
    });

    it('should have reasonable cost values', () => {
      expect(CREDIT_COSTS.TRANSCRIPTION_PER_MINUTE).toBeGreaterThan(0);
      expect(CREDIT_COSTS.VIDEO_EXPORT_4K).toBeGreaterThan(CREDIT_COSTS.VIDEO_EXPORT_SD);
    });
  });

  describe('CREDIT_PACKAGES', () => {
    it('should have defined packages', () => {
      expect(CREDIT_PACKAGES.STARTER).toBeDefined();
      expect(CREDIT_PACKAGES.PRO).toBeDefined();
      expect(CREDIT_PACKAGES.BUSINESS).toBeDefined();
    });

    it('should have correct package values', () => {
      expect(CREDIT_PACKAGES.STARTER.credits).toBe(100);
      expect(CREDIT_PACKAGES.PRO.credits).toBe(500);
      expect(CREDIT_PACKAGES.BUSINESS.credits).toBe(2000);
    });
  });

  describe('getCreditBalance', () => {
    it('should return balance from database', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 50 });
      
      const balance = await getCreditBalance(userId, brandId);
      
      expect(balance).toBe(50);
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [userId, brandId]
      );
    });

    it('should return 0 if no transactions exist', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 0 });
      
      const balance = await getCreditBalance(userId, brandId);
      
      expect(balance).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      mockDb.one.mockRejectedValueOnce(new Error('Database error'));
      
      const balance = await getCreditBalance(userId, brandId);
      
      expect(balance).toBe(0);
    });
  });

  describe('hasEnoughCredits', () => {
    it('should return true when user has enough credits', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 100 });
      
      const result = await hasEnoughCredits(userId, brandId, 50);
      
      expect(result).toBe(true);
    });

    it('should return false when user lacks credits', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 10 });
      
      const result = await hasEnoughCredits(userId, brandId, 50);
      
      expect(result).toBe(false);
    });

    it('should return true for zero cost', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 0 });
      
      const result = await hasEnoughCredits(userId, brandId, 0);
      
      expect(result).toBe(true);
    });
  });

  describe('deductCredits', () => {
    it('should deduct credits successfully', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 100 }); // Check balance
      mockDb.query.mockResolvedValueOnce({}); // Insert transaction
      mockDb.one.mockResolvedValueOnce({ balance: 90 }); // New balance
      
      const result = await deductCredits(userId, brandId, 10, 'test-operation', { test: true });
      
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(90);
      expect(result.transactionId).toBeDefined();
    });

    it('should throw error for insufficient credits', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 5 });
      
      await expect(deductCredits(userId, brandId, 10, 'test'))
        .rejects.toThrow('Insufficient credits');
    });

    it('should handle database errors', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 100 });
      mockDb.query.mockRejectedValueOnce(new Error('DB error'));
      
      await expect(deductCredits(userId, brandId, 10, 'test'))
        .rejects.toThrow();
    });
  });

  describe('addCredits', () => {
    it('should add credits successfully', async () => {
      mockDb.query.mockResolvedValueOnce({}); // Insert transaction
      mockDb.one.mockResolvedValueOnce({ balance: 110 }); // New balance
      
      const result = await addCredits(userId, brandId, 10, 'purchase', { package: 'STARTER' });
      
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(110);
    });

    it('should reject negative amounts', async () => {
      await expect(addCredits(userId, brandId, -10, 'test'))
        .rejects.toThrow('Credit amount must be positive');
    });

    it('should reject zero amounts', async () => {
      await expect(addCredits(userId, brandId, 0, 'test'))
        .rejects.toThrow('Credit amount must be positive');
    });
  });

  describe('getCreditHistory', () => {
    it('should return transaction history', async () => {
      const mockTransactions = [
        { id: 't1', type: 'credit', amount: 100, created_at: new Date() },
        { id: 't2', type: 'debit', amount: 10, created_at: new Date() }
      ];
      mockDb.query.mockResolvedValueOnce(mockTransactions);
      
      const result = await getCreditHistory(userId, brandId, { limit: 10 });
      
      expect(result.transactions).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should handle empty history', async () => {
      mockDb.query.mockResolvedValueOnce([]);
      
      const result = await getCreditHistory(userId, brandId);
      
      expect(result.transactions).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('chargeForOperation', () => {
    it('should charge for operation successfully', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 100 });
      mockDb.query.mockResolvedValueOnce({});
      mockDb.one.mockResolvedValueOnce({ balance: 97 });
      
      const result = await chargeForOperation(userId, brandId, 'AI Script Generation', 3, {});
      
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(97);
      expect(result.creditsCharged).toBe(3);
    });

    it('should return error for insufficient credits', async () => {
      mockDb.one.mockResolvedValueOnce({ balance: 1 });
      
      const result = await chargeForOperation(userId, brandId, 'Expensive Op', 10, {});
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('INSUFFICIENT_CREDITS');
      expect(result.available).toBe(1);
      expect(result.required).toBe(10);
    });
  });
});
