// ─── Processing Job ──────────────────────────────────────────────────────────

export const JOB_STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead',
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

export const JOB_TYPE = {
  IMAGE_PROCESS: 'image_process',
  VIDEO_TRANSCODE: 'video_transcode',
  THUMBNAIL_GENERATE: 'thumbnail_generate',
  MANIFEST_GENERATE: 'manifest_generate',
  AUDIO_EXTRACT: 'audio_extract',
} as const;

export type JobType = (typeof JOB_TYPE)[keyof typeof JOB_TYPE];

export interface ProcessingJob {
  id: string;
  assetId: string;
  jobType: JobType;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  errorStack: string | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Job Queue Payloads ──────────────────────────────────────────────────────

export interface ImageProcessJobPayload {
  assetId: string;
  storageKey: string;
  mimeType: string;
}

export interface VideoTranscodeJobPayload {
  assetId: string;
  storageKey: string;
  mimeType: string;
}

export interface ThumbnailGenerateJobPayload {
  assetId: string;
  storageKey: string;
}

export interface ManifestGenerateJobPayload {
  assetId: string;
  variantStorageKeys: string[];
}

export interface AudioExtractJobPayload {
  assetId: string;
  storageKey: string;
}

export type JobPayload =
  | ImageProcessJobPayload
  | VideoTranscodeJobPayload
  | ThumbnailGenerateJobPayload
  | ManifestGenerateJobPayload
  | AudioExtractJobPayload;
