import { z } from 'zod';
import {
  SUPPORTED_IMAGE_MIMES,
  SUPPORTED_VIDEO_MIMES,
  ALL_SUPPORTED_MIMES,
} from '../types/media.js';
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT,
  MAX_VIDEO_DURATION_SECONDS,
} from '../constants.js';

// ─── Upload ───────────────────────────────────────────────────────────────────

export const UploadQuerySchema = z.object({
  // Optional crop parameters (future use, Phase 3)
  cropX: z.coerce.number().int().nonnegative().optional(),
  cropY: z.coerce.number().int().nonnegative().optional(),
  cropWidth: z.coerce.number().int().positive().optional(),
  cropHeight: z.coerce.number().int().positive().optional(),
});

export type UploadQuery = z.infer<typeof UploadQuerySchema>;

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof PaginationSchema>;

// ─── Asset ID param ───────────────────────────────────────────────────────────

export const AssetParamsSchema = z.object({
  id: z.string().uuid(),
});

export type AssetParams = z.infer<typeof AssetParamsSchema>;

// ─── File validation ──────────────────────────────────────────────────────────

export function isSupportedMimeType(mime: string): boolean {
  return (ALL_SUPPORTED_MIMES as readonly string[]).includes(mime);
}

export function isImageMimeType(mime: string): boolean {
  return (SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mime);
}

export function isVideoMimeType(mime: string): boolean {
  return (SUPPORTED_VIDEO_MIMES as readonly string[]).includes(mime);
}

export function validateFileSize(sizeBytes: number, mimeType: string): void {
  const isImage = isImageMimeType(mimeType);
  const maxBytes = isImage ? MAX_IMAGE_SIZE_BYTES : MAX_VIDEO_SIZE_BYTES;

  if (sizeBytes > maxBytes) {
    const maxMB = Math.round(maxBytes / 1024 / 1024);
    throw new Error(
      `File size ${sizeBytes} bytes exceeds the ${maxMB} MB limit for ${isImage ? 'images' : 'videos'}`,
    );
  }
}

export function validateImageDimensions(width: number, height: number): void {
  if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
    throw new Error(
      `Image dimensions ${width}×${height} exceed the maximum ${MAX_IMAGE_WIDTH}×${MAX_IMAGE_HEIGHT}`,
    );
  }
}

export function validateVideoDuration(durationSeconds: number): void {
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(
      `Video duration ${durationSeconds}s exceeds the maximum ${MAX_VIDEO_DURATION_SECONDS}s`,
    );
  }
}
