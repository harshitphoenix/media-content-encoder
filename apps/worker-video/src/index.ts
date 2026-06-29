import { Worker, type Job } from 'bullmq';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb, mediaAssets, processingJobs } from '@mce/db';
import { StorageClient } from '@mce/storage';
import { QUEUE_NAMES, type VideoTranscodeJobPayload } from '@mce/shared';
import { transcodeVideoJob } from './processor.js';

// ── Config ─────────────────────────────────────────────────────────────────────

const ConfigSchema = z.object({
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  STORAGE_ENDPOINT: z.string().min(1),
  STORAGE_REGION: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_BUCKET_ORIGINALS: z.string().min(1),
  STORAGE_BUCKET_VARIANTS: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z.string().transform(v => v === 'true').default('false'),
  CDN_BASE_URL: z.string().min(1),
  CDN_URL_TTL_SECONDS: z.coerce.number().positive().default(3600),
  FFMPEG_PATH: z.string().default('ffmpeg'),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Worker config error:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const config = parsed.data;

// ── Connections ────────────────────────────────────────────────────────────────

const db = createDb(config.DATABASE_URL);

const storage = new StorageClient({
  endpoint: config.STORAGE_ENDPOINT,
  region: config.STORAGE_REGION,
  accessKeyId: config.STORAGE_ACCESS_KEY_ID,
  secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
  bucketOriginals: config.STORAGE_BUCKET_ORIGINALS,
  bucketVariants: config.STORAGE_BUCKET_VARIANTS,
  cdnBaseUrl: config.CDN_BASE_URL,
  cdnUrlTtlSeconds: config.CDN_URL_TTL_SECONDS,
  forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
});

function parseRedisUrl(urlString: string) {
  const u = new URL(urlString);
  return {
    host: u.hostname,
    port: parseInt(u.port || '6379', 10),
    password: u.password || undefined,
    db: parseInt(u.pathname.slice(1) || '0', 10),
    maxRetriesPerRequest: null, // required by BullMQ
  };
}

const connection = parseRedisUrl(config.REDIS_URL);

// ── Job processor ──────────────────────────────────────────────────────────────

async function transcodeVideo(job: Job<VideoTranscodeJobPayload>): Promise<void> {
  const { assetId } = job.data;
  const now = new Date();

  console.info({ jobId: job.id, assetId, attempt: job.attemptsMade + 1 }, 'Video transcode job started');

  // Transition: → PROCESSING
  await db
    .update(processingJobs)
    .set({ status: 'processing', startedAt: now, attempts: job.attemptsMade + 1, updatedAt: now })
    .where(eq(processingJobs.id, job.id!));

  await db
    .update(mediaAssets)
    .set({ status: 'processing', updatedAt: now })
    .where(eq(mediaAssets.id, assetId));

  // Run the full ffmpeg transcoding pipeline
  await transcodeVideoJob({ id: job.id!, data: job.data }, db, storage, config.FFMPEG_PATH);

  // Transition: → COMPLETED
  const completedAt = new Date();
  await db
    .update(processingJobs)
    .set({ status: 'completed', completedAt, updatedAt: completedAt })
    .where(eq(processingJobs.id, job.id!));

  await db
    .update(mediaAssets)
    .set({ status: 'ready', updatedAt: completedAt })
    .where(eq(mediaAssets.id, assetId));

  console.info({ jobId: job.id, assetId }, 'Video transcode job completed');
}

// ── Worker ─────────────────────────────────────────────────────────────────────

const worker = new Worker<VideoTranscodeJobPayload>(
  QUEUE_NAMES.VIDEO_TRANSCODE,
  transcodeVideo,
  { connection, concurrency: 2 },
);

worker.on('completed', (job) => {
  console.info({ jobId: job.id }, 'Video transcode job completed successfully');
});

worker.on('failed', async (job, err) => {
  if (!job) return;

  const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
  const finalStatus = exhausted ? 'dead' : 'failed';
  const now = new Date();

  console.error(
    { jobId: job.id, assetId: job.data.assetId, attempt: job.attemptsMade, exhausted },
    `Video transcode job ${finalStatus}: ${err.message}`,
  );

  try {
    await db
      .update(processingJobs)
      .set({
        status: finalStatus,
        errorMessage: err.message.slice(0, 1000),
        updatedAt: now,
        ...(exhausted ? { completedAt: now } : {}),
      })
      .where(eq(processingJobs.id, job.id!));

    if (exhausted) {
      await db
        .update(mediaAssets)
        .set({ status: 'failed', updatedAt: now })
        .where(eq(mediaAssets.id, job.data.assetId));
    }
  } catch (dbErr) {
    console.error({ jobId: job.id, dbErr }, 'Failed to update job status after failure');
  }
});

worker.on('error', (err) => {
  console.error({ err }, 'Worker error');
});

console.info(`Video worker started, listening on queue: ${QUEUE_NAMES.VIDEO_TRANSCODE}`);

// ── Graceful shutdown ──────────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  console.info({ signal }, 'Shutting down video worker');
  await worker.close();
  process.exit(0);
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
