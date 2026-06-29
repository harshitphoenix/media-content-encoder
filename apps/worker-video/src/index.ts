import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createDb, mediaAssets, processingJobs } from '@mce/db';
import { QUEUE_NAMES, type VideoTranscodeJobPayload } from '@mce/shared';

// ── Config from environment ────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Required environment variable ${name} is missing`);
    process.exit(1);
  }
  return val;
}

const REDIS_URL = requireEnv('REDIS_URL');
const DATABASE_URL = requireEnv('DATABASE_URL');

// ── Connections ────────────────────────────────────────────────────────────────

const db = createDb(DATABASE_URL);

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

const connection = parseRedisUrl(REDIS_URL);

// ── Job processor ──────────────────────────────────────────────────────────────

async function transcodeVideo(job: Job<VideoTranscodeJobPayload>): Promise<void> {
  const { assetId, storageKey, mimeType } = job.data;
  const now = new Date();

  console.info({ jobId: job.id, assetId, attempt: job.attemptsMade + 1 }, 'Video transcode job started');

  // Transition: → PROCESSING
  await db
    .update(processingJobs)
    .set({
      status: 'processing',
      startedAt: now,
      attempts: job.attemptsMade + 1,
      updatedAt: now,
    })
    .where(eq(processingJobs.id, job.id!));

  await db
    .update(mediaAssets)
    .set({ status: 'processing', updatedAt: now })
    .where(eq(mediaAssets.id, assetId));

  // TODO (Phase 4): implement video transcoding pipeline
  // - Download original from storage (storageKey)
  // - Generate renditions: 240p, 360p, 480p, 720p, 1080p using ffmpeg
  // - Apply H.264 + AAC codec settings with bitrate ladder
  // - Upload renditions to storage
  // - Insert mediaVariants rows in DB
  // - Enqueue thumbnail_generate + manifest_generate jobs (Phase 5)
  void storageKey;
  void mimeType;

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
  {
    connection,
    concurrency: 2, // video transcoding is CPU-intensive
  },
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
