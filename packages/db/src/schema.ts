import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  bigint,
  boolean,
  integer,
  real,
  text,
  timestamp,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const assetStatusEnum = pgEnum('asset_status', [
  'pending',
  'processing',
  'ready',
  'failed',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'queued',
  'processing',
  'completed',
  'failed',
  'dead',
]);

export const jobTypeEnum = pgEnum('job_type', [
  'image_process',
  'video_transcode',
  'thumbnail_generate',
  'manifest_generate',
  'audio_extract',
]);

export const variantTypeEnum = pgEnum('variant_type', [
  'image_thumbnail',
  'image_small',
  'image_medium',
  'image_large',
  'image_original',
  'video_240p',
  'video_360p',
  'video_480p',
  'video_720p',
  'video_1080p',
  'audio_normalized',
]);

export const outputFormatEnum = pgEnum('output_format', [
  'webp',
  'avif',
  'jpeg',
  'mp4',
  'webm',
  'mp3',
  'aac',
]);

export const manifestTypeEnum = pgEnum('manifest_type', ['hls', 'dash']);

export const thumbnailTypeEnum = pgEnum('thumbnail_type', ['cover', 'preview', 'timeline']);

// ─── users ────────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 256 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('idx_users_email').on(t.email),
  }),
);

// ─── media_assets ─────────────────────────────────────────────────────────────

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK to users — nullable so assets can exist before auth was introduced
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    originalFilename: varchar('original_filename', { length: 512 }).notNull(),
    // bigint stored as string in drizzle for precision; cast at app layer
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: assetStatusEnum('status').notNull().default('pending'),
    storageKey: varchar('storage_key', { length: 1024 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('idx_media_assets_owner_id').on(t.ownerId),
    statusIdx: index('idx_media_assets_status').on(t.status),
    createdAtIdx: index('idx_media_assets_created_at').on(t.createdAt),
  }),
);

// ─── image_metadata ───────────────────────────────────────────────────────────

export const imageMetadata = pgTable(
  'image_metadata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id').notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    format: varchar('format', { length: 64 }).notNull(),
    colorSpace: varchar('color_space', { length: 64 }),
    hasAlpha: boolean('has_alpha').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assetFk: foreignKey({ columns: [t.assetId], foreignColumns: [mediaAssets.id] }).onDelete(
      'cascade',
    ),
  }),
);

// ─── video_metadata ───────────────────────────────────────────────────────────

export const videoMetadata = pgTable(
  'video_metadata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id').notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    durationSeconds: real('duration_seconds').notNull(),
    codec: varchar('codec', { length: 64 }).notNull(),
    fps: real('fps').notNull(),
    bitrateBps: bigint('bitrate_bps', { mode: 'number' }).notNull(),
    audioCodec: varchar('audio_codec', { length: 64 }),
    audioChannels: integer('audio_channels'),
    audioSampleRateHz: integer('audio_sample_rate_hz'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assetFk: foreignKey({ columns: [t.assetId], foreignColumns: [mediaAssets.id] }).onDelete(
      'cascade',
    ),
  }),
);

// ─── processing_jobs ──────────────────────────────────────────────────────────

export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id').notNull(),
    jobType: jobTypeEnum('job_type').notNull(),
    status: jobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    errorMessage: text('error_message'),
    errorStack: text('error_stack'),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assetFk: foreignKey({ columns: [t.assetId], foreignColumns: [mediaAssets.id] }).onDelete(
      'cascade',
    ),
    assetIdx: index('idx_processing_jobs_asset_id').on(t.assetId),
    statusIdx: index('idx_processing_jobs_status').on(t.status),
    typeStatusIdx: index('idx_processing_jobs_type_status').on(t.jobType, t.status),
  }),
);

// ─── media_variants ───────────────────────────────────────────────────────────

export const mediaVariants = pgTable(
  'media_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id').notNull(),
    jobId: uuid('job_id').notNull(),
    variantType: variantTypeEnum('variant_type').notNull(),
    format: outputFormatEnum('format').notNull(),
    width: integer('width'),
    height: integer('height'),
    bitrateBps: bigint('bitrate_bps', { mode: 'number' }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: varchar('storage_key', { length: 1024 }).notNull(),
    cdnUrl: varchar('cdn_url', { length: 2048 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assetFk: foreignKey({ columns: [t.assetId], foreignColumns: [mediaAssets.id] }).onDelete(
      'cascade',
    ),
    jobFk: foreignKey({ columns: [t.jobId], foreignColumns: [processingJobs.id] }).onDelete(
      'cascade',
    ),
    assetIdx: index('idx_media_variants_asset_id').on(t.assetId),
    assetTypeFormatIdx: index('idx_media_variants_asset_type_format').on(
      t.assetId,
      t.variantType,
      t.format,
    ),
  }),
);

// ─── streaming_manifests ──────────────────────────────────────────────────────

export const streamingManifests = pgTable(
  'streaming_manifests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id').notNull(),
    manifestType: manifestTypeEnum('manifest_type').notNull(),
    storageKey: varchar('storage_key', { length: 1024 }).notNull(),
    cdnUrl: varchar('cdn_url', { length: 2048 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assetFk: foreignKey({ columns: [t.assetId], foreignColumns: [mediaAssets.id] }).onDelete(
      'cascade',
    ),
    assetTypeIdx: index('idx_streaming_manifests_asset_type').on(t.assetId, t.manifestType),
  }),
);

// ─── thumbnail_entries ────────────────────────────────────────────────────────

export const thumbnailEntries = pgTable(
  'thumbnail_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id').notNull(),
    thumbnailType: thumbnailTypeEnum('thumbnail_type').notNull(),
    storageKey: varchar('storage_key', { length: 1024 }).notNull(),
    cdnUrl: varchar('cdn_url', { length: 2048 }),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    timestampSeconds: real('timestamp_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assetFk: foreignKey({ columns: [t.assetId], foreignColumns: [mediaAssets.id] }).onDelete(
      'cascade',
    ),
    assetTypeIdx: index('idx_thumbnail_entries_asset_type').on(t.assetId, t.thumbnailType),
  }),
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const userRelations = relations(users, ({ many }) => ({
  mediaAssets: many(mediaAssets),
}));

export const mediaAssetRelations = relations(mediaAssets, ({ one, many }) => ({
  owner: one(users, { fields: [mediaAssets.ownerId], references: [users.id] }),
  imageMetadata: one(imageMetadata, { fields: [mediaAssets.id], references: [imageMetadata.assetId] }),
  videoMetadata: one(videoMetadata, { fields: [mediaAssets.id], references: [videoMetadata.assetId] }),
  processingJobs: many(processingJobs),
  mediaVariants: many(mediaVariants),
  streamingManifests: many(streamingManifests),
  thumbnailEntries: many(thumbnailEntries),
}));

export const processingJobRelations = relations(processingJobs, ({ one, many }) => ({
  asset: one(mediaAssets, { fields: [processingJobs.assetId], references: [mediaAssets.id] }),
  mediaVariants: many(mediaVariants),
}));

export const mediaVariantRelations = relations(mediaVariants, ({ one }) => ({
  asset: one(mediaAssets, { fields: [mediaVariants.assetId], references: [mediaAssets.id] }),
  job: one(processingJobs, { fields: [mediaVariants.jobId], references: [processingJobs.id] }),
}));
