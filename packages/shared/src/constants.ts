// ─── File Limits ─────────────────────────────────────────────────────────────

export const MAX_IMAGE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_VIDEO_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
export const MAX_IMAGE_WIDTH = 7680; // 8K
export const MAX_IMAGE_HEIGHT = 4320; // 8K
export const MAX_VIDEO_DURATION_SECONDS = 7200; // 2 hours

// ─── Image Variant Dimensions ─────────────────────────────────────────────────

export const IMAGE_VARIANT_SIZES = {
  thumbnail: 150,
  small: 320,
  medium: 640,
  large: 1280,
} as const satisfies Record<string, number>;

// ─── Video Resolution Targets ─────────────────────────────────────────────────

export const VIDEO_RENDITIONS = {
  '240p': { width: 426, height: 240, minBitrate: 400_000, maxBitrate: 800_000 },
  '360p': { width: 640, height: 360, minBitrate: 800_000, maxBitrate: 1_200_000 },
  '480p': { width: 854, height: 480, minBitrate: 1_200_000, maxBitrate: 2_500_000 },
  '720p': { width: 1280, height: 720, minBitrate: 2_500_000, maxBitrate: 5_000_000 },
  '1080p': { width: 1920, height: 1080, minBitrate: 5_000_000, maxBitrate: 8_000_000 },
} as const;

export type VideoRenditionLabel = keyof typeof VIDEO_RENDITIONS;

// ─── Queue Names ──────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  IMAGE_PROCESS: 'image-process',
  VIDEO_TRANSCODE: 'video-transcode',
  THUMBNAIL_GENERATE: 'thumbnail-generate',
  MANIFEST_GENERATE: 'manifest-generate',
  AUDIO_EXTRACT: 'audio-extract',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Storage Buckets ──────────────────────────────────────────────────────────

export const BUCKET = {
  ORIGINALS: 'originals',
  VARIANTS: 'variants',
} as const;

// ─── Job Defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_JOB_MAX_ATTEMPTS = 3;
export const DEFAULT_JOB_BACKOFF_BASE_MS = 5_000;
