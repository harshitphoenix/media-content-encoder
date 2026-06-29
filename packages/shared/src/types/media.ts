// ─── Media Asset ────────────────────────────────────────────────────────────

export const ASSET_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export type AssetStatus = (typeof ASSET_STATUS)[keyof typeof ASSET_STATUS];

export const MIME_TYPE = {
  // Images
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  AVIF: 'image/avif',
  GIF: 'image/gif',
  // Video
  MP4: 'video/mp4',
  MOV: 'video/quicktime',
  MKV: 'video/x-matroska',
  WEBM: 'video/webm',
} as const;

export type MimeType = (typeof MIME_TYPE)[keyof typeof MIME_TYPE];

export const SUPPORTED_IMAGE_MIMES: readonly MimeType[] = [
  MIME_TYPE.JPEG,
  MIME_TYPE.PNG,
  MIME_TYPE.WEBP,
  MIME_TYPE.AVIF,
];

export const SUPPORTED_VIDEO_MIMES: readonly MimeType[] = [
  MIME_TYPE.MP4,
  MIME_TYPE.MOV,
  MIME_TYPE.MKV,
  MIME_TYPE.WEBM,
];

export const ALL_SUPPORTED_MIMES: readonly MimeType[] = [
  ...SUPPORTED_IMAGE_MIMES,
  ...SUPPORTED_VIDEO_MIMES,
];

export interface MediaAsset {
  id: string;
  ownerId: string | null;
  mimeType: MimeType;
  originalFilename: string;
  sizeBytes: number;
  status: AssetStatus;
  storageKey: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Media Metadata ──────────────────────────────────────────────────────────

export interface ImageMetadata {
  assetId: string;
  width: number;
  height: number;
  format: string;
  colorSpace: string | null;
  hasAlpha: boolean;
  createdAt: Date;
}

export interface VideoMetadata {
  assetId: string;
  width: number;
  height: number;
  durationSeconds: number;
  codec: string;
  fps: number;
  bitrateBps: number;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRateHz: number | null;
  createdAt: Date;
}

export type MediaMetadata = ImageMetadata | VideoMetadata;

// ─── Media Variant ───────────────────────────────────────────────────────────

export const VARIANT_TYPE = {
  // Image variants
  IMAGE_THUMBNAIL: 'image_thumbnail',
  IMAGE_SMALL: 'image_small',
  IMAGE_MEDIUM: 'image_medium',
  IMAGE_LARGE: 'image_large',
  IMAGE_ORIGINAL: 'image_original',
  // Video renditions
  VIDEO_240P: 'video_240p',
  VIDEO_360P: 'video_360p',
  VIDEO_480P: 'video_480p',
  VIDEO_720P: 'video_720p',
  VIDEO_1080P: 'video_1080p',
  // Audio
  AUDIO_NORMALIZED: 'audio_normalized',
} as const;

export type VariantType = (typeof VARIANT_TYPE)[keyof typeof VARIANT_TYPE];

export const OUTPUT_FORMAT = {
  WEBP: 'webp',
  AVIF: 'avif',
  JPEG: 'jpeg',
  MP4: 'mp4',
  WEBM: 'webm',
  MP3: 'mp3',
  AAC: 'aac',
} as const;

export type OutputFormat = (typeof OUTPUT_FORMAT)[keyof typeof OUTPUT_FORMAT];

export interface MediaVariant {
  id: string;
  assetId: string;
  jobId: string;
  variantType: VariantType;
  format: OutputFormat;
  width: number | null;
  height: number | null;
  bitrateBps: number | null;
  sizeBytes: number;
  storageKey: string;
  cdnUrl: string | null;
  createdAt: Date;
}

// ─── Streaming Manifest ──────────────────────────────────────────────────────

export const MANIFEST_TYPE = {
  HLS: 'hls',
  DASH: 'dash',
} as const;

export type ManifestType = (typeof MANIFEST_TYPE)[keyof typeof MANIFEST_TYPE];

export interface StreamingManifest {
  id: string;
  assetId: string;
  manifestType: ManifestType;
  storageKey: string;
  cdnUrl: string | null;
  createdAt: Date;
}

// ─── Thumbnail Set ───────────────────────────────────────────────────────────

export const THUMBNAIL_TYPE = {
  COVER: 'cover',
  PREVIEW: 'preview',
  TIMELINE: 'timeline',
} as const;

export type ThumbnailType = (typeof THUMBNAIL_TYPE)[keyof typeof THUMBNAIL_TYPE];

export interface ThumbnailEntry {
  id: string;
  assetId: string;
  thumbnailType: ThumbnailType;
  storageKey: string;
  cdnUrl: string | null;
  width: number;
  height: number;
  timestampSeconds: number | null;
  createdAt: Date;
}
