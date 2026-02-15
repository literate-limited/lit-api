/**
 * OpenAI Service
 *
 * Handles AI-powered features for TeleprompTV:
 * - Video transcription using Whisper API
 * - Script generation and enhancement
 * - Content analysis
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DEFAULT_STT_MODEL = process.env.TTV_STT_MODEL || 'whisper-1';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB limit for Whisper API

/**
 * Transcribe audio/video file using Whisper API
 * @param {string} filePath - Path to audio/video file
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} - Transcription result
 */
export async function transcribeAudio(filePath, options = {}) {
  try {
    const {
      language = 'en',
      model = DEFAULT_STT_MODEL,
      responseFormat = 'verbose_json',
      temperature = 0
    } = options;

    // Check file size
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(`File size (${Math.round(stats.size / 1024 / 1024)}MB) exceeds Whisper API limit (25MB)`);
    }

    // Create read stream
    const fileStream = fs.createReadStream(filePath);

    // Call Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model,
      language,
      response_format: responseFormat,
      temperature
    });

    // Parse response based on format
    if (responseFormat === 'verbose_json') {
      return {
        success: true,
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
        segments: transcription.segments?.map(seg => ({
          id: seg.id,
          startTime: seg.start,
          endTime: seg.end,
          text: seg.text,
          confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : null
        })),
        wordCount: transcription.text.split(/\s+/).length
      };
    }

    return {
      success: true,
      text: transcription,
      wordCount: transcription.split(/\s+/).length
    };
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

/**
 * Transcribe from a buffer (for in-memory processing)
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} fileName - Original file name
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} - Transcription result
 */
export async function transcribeBuffer(audioBuffer, fileName, options = {}) {
  try {
    const tempDir = '/tmp';
    const tempPath = path.join(tempDir, `temp-${Date.now()}-${fileName}`);

    // Write buffer to temp file
    fs.writeFileSync(tempPath, audioBuffer);

    // Transcribe
    const result = await transcribeAudio(tempPath, options);

    // Clean up temp file
    fs.unlinkSync(tempPath);

    return result;
  } catch (error) {
    console.error('Buffer transcription error:', error);
    throw new Error(`Failed to transcribe buffer: ${error.message}`);
  }
}

/**
 * Generate VTT (WebVTT) subtitle format from segments
 * @param {Array} segments - Transcription segments
 * @returns {string} - VTT formatted string
 */
export function generateVTT(segments) {
  if (!segments || segments.length === 0) {
    return 'WEBVTT\n\n';
  }

  let vtt = 'WEBVTT\n\n';

  segments.forEach((seg, index) => {
    const startTime = formatVTTTime(seg.startTime);
    const endTime = formatVTTTime(seg.endTime);

    vtt += `${index + 1}\n`;
    vtt += `${startTime} --> ${endTime}\n`;
    vtt += `${seg.text.trim()}\n\n`;
  });

  return vtt;
}

/**
 * Generate SRT subtitle format from segments
 * @param {Array} segments - Transcription segments
 * @returns {string} - SRT formatted string
 */
export function generateSRT(segments) {
  if (!segments || segments.length === 0) {
    return '';
  }

  let srt = '';

  segments.forEach((seg, index) => {
    const startTime = formatSRTTime(seg.startTime);
    const endTime = formatSRTTime(seg.endTime);

    srt += `${index + 1}\n`;
    srt += `${startTime} --> ${endTime}\n`;
    srt += `${seg.text.trim()}\n\n`;
  });

  return srt;
}

/**
 * Format time for VTT (HH:MM:SS.mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted time
 */
function formatVTTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Format time for SRT (HH:MM:SS,mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted time
 */
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Enhance script text using GPT
 * @param {string} scriptText - Original script text
 * @param {Object} options - Enhancement options
 * @returns {Promise<Object>} - Enhanced script
 */
export async function enhanceScript(scriptText, options = {}) {
  try {
    const {
      style = 'professional',
      maxLength = null,
      instructions = null
    } = options;

    const systemPrompt = `You are a professional script editor. Enhance the following script to be more engaging and ${style}. Keep the core message but improve clarity, pacing, and impact.`;

    const userPrompt = [
      scriptText,
      instructions ? `\n\nAdditional instructions: ${instructions}` : '',
      maxLength ? `\n\nTarget length: approximately ${maxLength} words` : ''
    ].join('');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    const enhancedText = completion.choices[0].message.content;

    return {
      success: true,
      originalText: scriptText,
      enhancedText,
      wordCount: enhancedText.split(/\s+/).length,
      usage: completion.usage
    };
  } catch (error) {
    console.error('Script enhancement error:', error);
    throw new Error(`Failed to enhance script: ${error.message}`);
  }
}

/**
 * Generate script suggestions based on topic
 * @param {string} topic - Script topic
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} - Generated script
 */
export async function generateScript(topic, options = {}) {
  try {
    const {
      style = 'professional',
      duration = 60, // seconds
      tone = 'informative'
    } = options;

    const wordsPerMinute = 150; // Average speaking pace
    const targetWords = Math.round((duration / 60) * wordsPerMinute);

    const systemPrompt = `You are a professional scriptwriter. Generate engaging teleprompt scripts that are clear, well-paced, and ${tone} in tone.`;

    const userPrompt = `Write a ${duration}-second ${style} script about: ${topic}\n\nTarget length: approximately ${targetWords} words.\n\nFormat the script for easy reading on a teleprompter with clear pacing marks.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 1500
    });

    const scriptText = completion.choices[0].message.content;

    return {
      success: true,
      topic,
      scriptText,
      estimatedDuration: duration,
      wordCount: scriptText.split(/\s+/).length,
      usage: completion.usage
    };
  } catch (error) {
    console.error('Script generation error:', error);
    throw new Error(`Failed to generate script: ${error.message}`);
  }
}

/**
 * Calculate estimated transcription cost
 * @param {number} durationSeconds - Audio duration in seconds
 * @returns {Object} - Cost estimate
 */
export function estimateTranscriptionCost(durationSeconds) {
  const WHISPER_PRICE_PER_MINUTE = 0.006; // $0.006 per minute as of 2024
  const durationMinutes = durationSeconds / 60;
  const estimatedCost = durationMinutes * WHISPER_PRICE_PER_MINUTE;

  return {
    durationSeconds,
    durationMinutes: Math.ceil(durationMinutes),
    estimatedCost: Math.ceil(estimatedCost * 100) / 100, // Round to 2 decimals
    currency: 'USD'
  };
}

export default {
  transcribeAudio,
  transcribeBuffer,
  generateVTT,
  generateSRT,
  enhanceScript,
  generateScript,
  estimateTranscriptionCost
};
