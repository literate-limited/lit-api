/**
 * S3 Service Unit Tests
 * Tests for AWS S3 integration without actual S3 calls (mocked)
 */

import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: mockSend
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadObjectCommand: jest.fn(),
  CopyObjectCommand: jest.fn()
}));

jest.unstable_mockModule('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl
}));

// Import service after mocking
const { 
  uploadToS3, 
  getPresignedUploadUrl, 
  getPresignedDownloadUrl,
  deleteFromS3,
  fileExists,
  getFileMetadata,
  uploadMultiple,
  copyFile
} = await import('../../services/s3.service.js');

describe('S3 Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_S3_BUCKET = 'test-bucket';
  });

  describe('uploadToS3', () => {
    it('should upload file successfully', async () => {
      mockSend.mockResolvedValueOnce({});
      
      const result = await uploadToS3(
        Buffer.from('test content'),
        'test-video.mp4',
        'brand-123',
        'videos'
      );
      
      expect(result.success).toBe(true);
      expect(result.s3Key).toMatch(/^videos\/brand-123\/[a-f0-9-]+\.mp4$/);
      expect(result.bucket).toBe('test-bucket');
    });

    it('should handle upload errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 error'));
      
      await expect(uploadToS3(
        Buffer.from('test'),
        'test.mp4',
        'brand-123'
      )).rejects.toThrow('Failed to upload to S3');
    });

    it('should use correct content type based on extension', async () => {
      mockSend.mockResolvedValueOnce({});
      
      await uploadToS3(Buffer.from('test'), 'video.mp4', 'brand-123');
      
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'video/mp4'
        })
      );
    });
  });

  describe('getPresignedUploadUrl', () => {
    it('should generate presigned upload URL', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://presigned-url.example.com');
      
      const result = await getPresignedUploadUrl('test.mp4', 'brand-123');
      
      expect(result.success).toBe(true);
      expect(result.uploadUrl).toBe('https://presigned-url.example.com');
      expect(result.s3Key).toMatch(/^videos\/brand-123\//);
      expect(result.expiresIn).toBe(3600);
    });

    it('should handle URL generation errors', async () => {
      mockGetSignedUrl.mockRejectedValueOnce(new Error('Signing error'));
      
      await expect(getPresignedUploadUrl('test.mp4', 'brand-123'))
        .rejects.toThrow('Failed to generate presigned URL');
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('should generate presigned download URL', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://download-url.example.com');
      
      const result = await getPresignedDownloadUrl('videos/brand-123/test.mp4');
      
      expect(result).toBe('https://download-url.example.com');
    });
  });

  describe('deleteFromS3', () => {
    it('should delete file successfully', async () => {
      mockSend.mockResolvedValueOnce({});
      
      const result = await deleteFromS3('videos/brand-123/test.mp4');
      
      expect(result).toBe(true);
    });

    it('should handle delete errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Delete error'));
      
      await expect(deleteFromS3('videos/test.mp4'))
        .rejects.toThrow('Failed to delete from S3');
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      mockSend.mockResolvedValueOnce({ ContentLength: 100 });
      
      const result = await fileExists('videos/test.mp4');
      
      expect(result).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);
      
      const result = await fileExists('videos/nonexistent.mp4');
      
      expect(result).toBe(false);
    });
  });

  describe('getFileMetadata', () => {
    it('should return file metadata', async () => {
      mockSend.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'video/mp4',
        LastModified: new Date('2024-01-01'),
        Metadata: { brandId: 'brand-123' }
      });
      
      const result = await getFileMetadata('videos/test.mp4');
      
      expect(result.size).toBe(1024);
      expect(result.contentType).toBe('video/mp4');
      expect(result.metadata.brandId).toBe('brand-123');
    });
  });

  describe('uploadMultiple', () => {
    it('should upload multiple files', async () => {
      mockSend.mockResolvedValue({});
      
      const files = [
        { content: Buffer.from('file1'), fileName: 'file1.mp4' },
        { content: Buffer.from('file2'), fileName: 'file2.mp4' }
      ];
      
      const results = await uploadMultiple(files, 'brand-123');
      
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });

  describe('copyFile', () => {
    it('should copy file within S3', async () => {
      mockSend.mockResolvedValueOnce({});
      
      const result = await copyFile('source/key.mp4', 'dest/key.mp4');
      
      expect(result.success).toBe(true);
      expect(result.s3Key).toBe('dest/key.mp4');
    });
  });
});
