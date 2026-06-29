import { fileTypeFromFile } from 'file-type';
import { stat } from 'node:fs/promises';
import {
  isSupportedMimeType,
  isImageMimeType,
  isVideoMimeType,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT,
  MAX_VIDEO_DURATION_SECONDS,
} from '@mce/shared';

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Reads the first bytes of a file and returns the real MIME type.
 * Returns null if the type cannot be determined from magic bytes.
 */
export async function detectFileType(filePath: string): Promise<string | null> {
  const result = await fileTypeFromFile(filePath);
  return result?.mime ?? null;
}

/**
 * Validates that the detected MIME type is in the supported list.
 * Throws ValidationError with a safe, user-facing message on failure.
 */
export function assertSupportedMimeType(detectedMime: string | null): string {
  if (!detectedMime) {
    throw new ValidationError(
      'File type could not be determined. Supported types: JPEG, PNG, WebP, AVIF, MP4, MOV, MKV, WebM.',
    );
  }
  if (!isSupportedMimeType(detectedMime)) {
    throw new ValidationError(
      `File type "${detectedMime}" is not supported. Supported types: JPEG, PNG, WebP, AVIF, MP4, MOV, MKV, WebM.`,
    );
  }
  return detectedMime;
}

/**
 * Validates file size against per-type limits.
 * Reads file size from disk — call after the upload has been written to the temp file.
 */
export async function assertFileSizeLimit(filePath: string, mimeType: string): Promise<number> {
  const { size } = await stat(filePath);
  const limit = isImageMimeType(mimeType) ? MAX_IMAGE_SIZE_BYTES : MAX_VIDEO_SIZE_BYTES;
  const typeName = isImageMimeType(mimeType) ? 'image' : 'video';
  const limitMB = Math.round(limit / 1024 / 1024);

  if (size > limit) {
    throw new ValidationError(
      `File size ${formatBytes(size)} exceeds the ${limitMB} MB limit for ${typeName} uploads.`,
    );
  }
  return size;
}

/** Throws ValidationError if image dimensions exceed the configured maximum. */
export function assertImageDimensions(width: number, height: number): void {
  if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
    throw new ValidationError(
      `Image dimensions ${width}×${height} exceed the maximum allowed ${MAX_IMAGE_WIDTH}×${MAX_IMAGE_HEIGHT}.`,
    );
  }
}

/** Throws ValidationError if video duration exceeds the configured maximum. */
export function assertVideoDuration(durationSeconds: number): void {
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    const maxMinutes = Math.round(MAX_VIDEO_DURATION_SECONDS / 60);
    throw new ValidationError(
      `Video duration ${Math.round(durationSeconds)}s exceeds the maximum ${maxMinutes} minutes.`,
    );
  }
}

/** Checks if MIME indicates image content. Re-exported for convenience. */
export { isImageMimeType, isVideoMimeType };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
