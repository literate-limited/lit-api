/**
 * FFmpeg Service
 *
 * Handles video processing operations for TeleprompTV:
 * - Video transcoding and compression
 * - Audio extraction
 * - Thumbnail generation
 * - Video merging and cutting
 * - Format conversion
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);

// Set FFmpeg path if specified in environment
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

const TEMP_DIR = '/tmp/ttv-processing';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Get video metadata
 * @param {string} inputPath - Path to video file
 * @returns {Promise<Object>} - Video metadata
 */
export async function getVideoMetadata(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to get video metadata: ${err.message}`));
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

      resolve({
        duration: metadata.format.duration,
        size: metadata.format.size,
        format: metadata.format.format_name,
        bitrate: metadata.format.bit_rate,
        video: videoStream ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          fps: eval(videoStream.r_frame_rate), // e.g., "30/1" -> 30
          bitrate: videoStream.bit_rate
        } : null,
        audio: audioStream ? {
          codec: audioStream.codec_name,
          sampleRate: audioStream.sample_rate,
          channels: audioStream.channels,
          bitrate: audioStream.bit_rate
        } : null
      });
    });
  });
}

/**
 * Extract audio from video
 * @param {string} inputPath - Path to video file
 * @param {string} outputPath - Path for audio output (optional)
 * @returns {Promise<string>} - Path to extracted audio file
 */
export async function extractAudio(inputPath, outputPath = null) {
  const outputFile = outputPath || path.join(TEMP_DIR, `audio-${Date.now()}.mp3`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .output(outputFile)
      .on('end', () => resolve(outputFile))
      .on('error', (err) => reject(new Error(`Audio extraction failed: ${err.message}`)))
      .run();
  });
}

/**
 * Generate thumbnail from video
 * @param {string} inputPath - Path to video file
 * @param {Object} options - Thumbnail options
 * @returns {Promise<string>} - Path to thumbnail file
 */
export async function generateThumbnail(inputPath, options = {}) {
  const {
    timestamp = '00:00:01',
    width = 1280,
    height = 720,
    outputPath = null
  } = options;

  const outputFile = outputPath || path.join(TEMP_DIR, `thumb-${Date.now()}.jpg`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: [timestamp],
        filename: path.basename(outputFile),
        folder: path.dirname(outputFile),
        size: `${width}x${height}`
      })
      .on('end', () => resolve(outputFile))
      .on('error', (err) => reject(new Error(`Thumbnail generation failed: ${err.message}`)));
  });
}

/**
 * Transcode video to specific format and quality
 * @param {string} inputPath - Path to input video
 * @param {string} outputPath - Path for output video
 * @param {Object} options - Transcoding options
 * @returns {Promise<string>} - Path to transcoded file
 */
export async function transcodeVideo(inputPath, outputPath, options = {}) {
  const {
    format = 'mp4',
    resolution = '1920x1080',
    videoCodec = 'libx264',
    audioCodec = 'aac',
    videoBitrate = '2000k',
    audioBitrate = '192k',
    fps = null,
    preset = 'medium',
    onProgress = null
  } = options;

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .videoCodec(videoCodec)
      .audioCodec(audioCodec)
      .videoBitrate(videoBitrate)
      .audioBitrate(audioBitrate)
      .size(resolution)
      .format(format);

    if (fps) {
      command = command.fps(fps);
    }

    if (videoCodec === 'libx264') {
      command = command.outputOptions([
        `-preset ${preset}`,
        '-movflags +faststart' // Enable progressive download for mp4
      ]);
    }

    command
      .output(outputPath)
      .on('progress', (progress) => {
        if (onProgress) {
          onProgress({
            percent: progress.percent,
            currentTime: progress.timemark,
            fps: progress.currentFps
          });
        }
      })
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`Transcoding failed: ${err.message}`)))
      .run();
  });
}

/**
 * Merge multiple video files
 * @param {Array<string>} inputPaths - Array of video file paths
 * @param {string} outputPath - Path for merged output
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<string>} - Path to merged file
 */
export async function mergeVideos(inputPaths, outputPath, onProgress = null) {
  if (!inputPaths || inputPaths.length === 0) {
    throw new Error('No input files provided for merging');
  }

  if (inputPaths.length === 1) {
    // No merge needed, just copy
    fs.copyFileSync(inputPaths[0], outputPath);
    return outputPath;
  }

  // Create concat list file
  const listPath = path.join(TEMP_DIR, `concat-${Date.now()}.txt`);
  const listContent = inputPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .videoCodec('copy')
      .audioCodec('copy')
      .output(outputPath)
      .on('progress', (progress) => {
        if (onProgress) {
          onProgress({
            percent: progress.percent,
            currentTime: progress.timemark
          });
        }
      })
      .on('end', async () => {
        // Clean up list file
        await unlinkAsync(listPath);
        resolve(outputPath);
      })
      .on('error', async (err) => {
        // Clean up list file
        try {
          await unlinkAsync(listPath);
        } catch (e) {
          // Ignore cleanup errors
        }
        reject(new Error(`Video merge failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Cut/trim video to specific time range
 * @param {string} inputPath - Path to input video
 * @param {string} outputPath - Path for output video
 * @param {Object} timeRange - Time range {start, end} in seconds
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<string>} - Path to trimmed file
 */
export async function cutVideo(inputPath, outputPath, timeRange, onProgress = null) {
  const { start = 0, end } = timeRange;

  if (!end || end <= start) {
    throw new Error('Invalid time range for video cut');
  }

  const duration = end - start;

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(start)
      .setDuration(duration)
      .videoCodec('copy')
      .audioCodec('copy')
      .output(outputPath)
      .on('progress', (progress) => {
        if (onProgress) {
          onProgress({
            percent: progress.percent,
            currentTime: progress.timemark
          });
        }
      })
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`Video cut failed: ${err.message}`)))
      .run();
  });
}

/**
 * Add watermark to video
 * @param {string} inputPath - Path to input video
 * @param {string} watermarkPath - Path to watermark image
 * @param {string} outputPath - Path for output video
 * @param {Object} options - Watermark options
 * @returns {Promise<string>} - Path to watermarked file
 */
export async function addWatermark(inputPath, watermarkPath, outputPath, options = {}) {
  const {
    position = 'bottomright',
    margin = 10,
    opacity = 0.7
  } = options;

  // Position mappings
  const positions = {
    topleft: `${margin}:${margin}`,
    topright: `main_w-overlay_w-${margin}:${margin}`,
    bottomleft: `${margin}:main_h-overlay_h-${margin}`,
    bottomright: `main_w-overlay_w-${margin}:main_h-overlay_h-${margin}`,
    center: '(main_w-overlay_w)/2:(main_h-overlay_h)/2'
  };

  const overlayPosition = positions[position] || positions.bottomright;

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .input(watermarkPath)
      .complexFilter([
        `[1:v]format=rgba,colorchannelmixer=aa=${opacity}[logo]`,
        `[0:v][logo]overlay=${overlayPosition}`
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`Watermark failed: ${err.message}`)))
      .run();
  });
}

/**
 * Compress video for web delivery
 * @param {string} inputPath - Path to input video
 * @param {string} outputPath - Path for output video
 * @param {Object} options - Compression options
 * @returns {Promise<Object>} - Compression result with stats
 */
export async function compressVideo(inputPath, outputPath, options = {}) {
  const {
    quality = 'medium', // low, medium, high
    maxWidth = 1920,
    onProgress = null
  } = options;

  // Quality presets
  const presets = {
    low: { crf: 28, preset: 'fast', maxBitrate: '1000k' },
    medium: { crf: 23, preset: 'medium', maxBitrate: '2000k' },
    high: { crf: 18, preset: 'slow', maxBitrate: '4000k' }
  };

  const preset = presets[quality] || presets.medium;

  const metadata = await getVideoMetadata(inputPath);
  const originalSize = metadata.size;

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        `-crf ${preset.crf}`,
        `-preset ${preset.preset}`,
        `-maxrate ${preset.maxBitrate}`,
        '-bufsize 4000k',
        `-vf scale='min(${maxWidth},iw)':-2`,
        '-movflags +faststart'
      ])
      .output(outputPath)
      .on('progress', (progress) => {
        if (onProgress) {
          onProgress({
            percent: progress.percent,
            currentTime: progress.timemark
          });
        }
      })
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`Compression failed: ${err.message}`)))
      .run();
  });

  const compressedSize = fs.statSync(outputPath).size;
  const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

  return {
    inputPath,
    outputPath,
    originalSize,
    compressedSize,
    compressionRatio: `${compressionRatio}%`,
    savedBytes: originalSize - compressedSize
  };
}

/**
 * Clean up temporary files
 * @param {string} filePath - Path to file to delete
 * @returns {Promise<void>}
 */
export async function cleanupTempFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      await unlinkAsync(filePath);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
    // Don't throw, just log
  }
}

/**
 * Clean up all temporary files in temp directory
 * @param {number} olderThanMs - Clean files older than this (milliseconds)
 * @returns {Promise<number>} - Number of files cleaned
 */
export async function cleanupTempDirectory(olderThanMs = 3600000) {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > olderThanMs) {
        await unlinkAsync(filePath);
        cleaned++;
      }
    }

    return cleaned;
  } catch (error) {
    console.error('Directory cleanup error:', error);
    return 0;
  }
}

export default {
  getVideoMetadata,
  extractAudio,
  generateThumbnail,
  transcodeVideo,
  mergeVideos,
  cutVideo,
  addWatermark,
  compressVideo,
  cleanupTempFile,
  cleanupTempDirectory
};
