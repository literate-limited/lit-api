/**
 * S3 Service
 *
 * Handles video upload, download, and management on AWS S3
 * for TeleprompTV features.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const S3_BUCKET = process.env.AWS_S3_BUCKET || 'teleprompt-videos';
const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

/**
 * Upload a file to S3
 * @param {Buffer|Stream} fileContent - File content to upload
 * @param {string} fileName - Original file name
 * @param {string} brandId - Brand ID for organization
 * @param {string} folder - Optional folder path (e.g., 'videos', 'thumbnails')
 * @returns {Promise<Object>} - S3 upload result with key and URL
 */
export async function uploadToS3(fileContent, fileName, brandId, folder = 'videos') {
  try {
    const fileExtension = path.extname(fileName);
    const s3Key = `${folder}/${brandId}/${uuidv4()}${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: fileContent,
      ContentType: getContentType(fileExtension),
      Metadata: {
        brandId,
        originalName: fileName,
        uploadedAt: new Date().toISOString()
      }
    });

    await s3Client.send(command);

    const url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;

    return {
      success: true,
      s3Key,
      s3Path: s3Key,
      s3Url: url,
      bucket: S3_BUCKET
    };
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error(`Failed to upload to S3: ${error.message}`);
  }
}

/**
 * Get a presigned URL for direct upload from browser
 * @param {string} fileName - File name
 * @param {string} brandId - Brand ID
 * @param {string} folder - Folder path
 * @returns {Promise<Object>} - Presigned URL and key
 */
export async function getPresignedUploadUrl(fileName, brandId, folder = 'videos') {
  try {
    const fileExtension = path.extname(fileName);
    const s3Key = `${folder}/${brandId}/${uuidv4()}${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      ContentType: getContentType(fileExtension),
      Metadata: {
        brandId,
        originalName: fileName
      }
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRY
    });

    return {
      success: true,
      uploadUrl: presignedUrl,
      s3Key,
      s3Path: s3Key,
      expiresIn: PRESIGNED_URL_EXPIRY
    };
  } catch (error) {
    console.error('Presigned URL generation error:', error);
    throw new Error(`Failed to generate presigned URL: ${error.message}`);
  }
}

/**
 * Get a presigned URL for downloading/viewing a file
 * @param {string} s3Key - S3 object key
 * @param {number} expiresIn - URL expiry in seconds
 * @returns {Promise<string>} - Presigned URL
 */
export async function getPresignedDownloadUrl(s3Key, expiresIn = PRESIGNED_URL_EXPIRY) {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });

    return presignedUrl;
  } catch (error) {
    console.error('Presigned download URL error:', error);
    throw new Error(`Failed to generate download URL: ${error.message}`);
  }
}

/**
 * Delete a file from S3
 * @param {string} s3Key - S3 object key
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteFromS3(s3Key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });

    await s3Client.send(command);

    return true;
  } catch (error) {
    console.error('S3 delete error:', error);
    throw new Error(`Failed to delete from S3: ${error.message}`);
  }
}

/**
 * Check if a file exists in S3
 * @param {string} s3Key - S3 object key
 * @returns {Promise<boolean>} - Exists status
 */
export async function fileExists(s3Key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Get file metadata from S3
 * @param {string} s3Key - S3 object key
 * @returns {Promise<Object>} - File metadata
 */
export async function getFileMetadata(s3Key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });

    const response = await s3Client.send(command);

    return {
      size: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      metadata: response.Metadata
    };
  } catch (error) {
    console.error('Get metadata error:', error);
    throw new Error(`Failed to get file metadata: ${error.message}`);
  }
}

/**
 * Get content type based on file extension
 * @param {string} extension - File extension
 * @returns {string} - MIME type
 */
function getContentType(extension) {
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.vtt': 'text/vtt',
    '.srt': 'application/x-subrip'
  };

  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * Upload multiple files in parallel
 * @param {Array<Object>} files - Array of {content, fileName, folder}
 * @param {string} brandId - Brand ID
 * @returns {Promise<Array>} - Upload results
 */
export async function uploadMultiple(files, brandId) {
  try {
    const uploadPromises = files.map(file =>
      uploadToS3(file.content, file.fileName, brandId, file.folder || 'videos')
    );

    const results = await Promise.all(uploadPromises);
    return results;
  } catch (error) {
    console.error('Multiple upload error:', error);
    throw new Error(`Failed to upload multiple files: ${error.message}`);
  }
}

/**
 * Copy a file within S3
 * @param {string} sourceKey - Source S3 key
 * @param {string} destinationKey - Destination S3 key
 * @returns {Promise<Object>} - Copy result
 */
export async function copyFile(sourceKey, destinationKey) {
  try {
    const { CopyObjectCommand } = await import('@aws-sdk/client-s3');

    const command = new CopyObjectCommand({
      Bucket: S3_BUCKET,
      CopySource: `${S3_BUCKET}/${sourceKey}`,
      Key: destinationKey
    });

    await s3Client.send(command);

    return {
      success: true,
      s3Key: destinationKey,
      s3Path: destinationKey
    };
  } catch (error) {
    console.error('S3 copy error:', error);
    throw new Error(`Failed to copy file: ${error.message}`);
  }
}

export default {
  uploadToS3,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteFromS3,
  fileExists,
  getFileMetadata,
  uploadMultiple,
  copyFile
};
