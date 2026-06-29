import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createDb, mediaAssets, processingJobs } from '@mce/db';
import { QUEUE_NAMES, type ImageProcessJobPayload } from '@mce/shared';

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

async function processImage(job: Job<ImageProcessJobPayload>): Promise<void> {
  const { assetId, storageKey, mimeType } = job.data;
  const now = new Date();

  console.info({ jobId: job.id, assetId, attempt: job.attemptsMade + 1 }, 'Image job started');

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

  // TODO (Phase 3): implement image processing pipeline
  // - Download original from storage (storageKey)
  // - Generate multi-resolution variants (150, 320, 640, 1280) using sharp
  // - Convert each to WebP, AVIF, JPEG
  // - Upload variants to storage
  // - Insert mediaVariants rows in DB
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

  console.info({ jobId: job.id, assetId }, 'Image job completed');
}

// ── Worker ─────────────────────────────────────────────────────────────────────

const worker = new Worker<ImageProcessJobPayload>(
  QUEUE_NAMES.IMAGE_PROCESS,
  processImage,
  {
    connection,
    concurrency: 5,
    // BullMQ moves the job to the failed list after all attempts are exhausted.
    // The 'failed' event handler below reads attempt counts to determine final state.
  },
);

worker.on('completed', (job) => {
  console.info({ jobId: job.id }, 'Image job completed successfully');
});

worker.on('failed', async (job, err) => {
  if (!job) return;

  const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
  const finalStatus = exhausted ? 'dead' : 'failed';
  const now = new Date();

  console.error(
    { jobId: job.id, assetId: job.data.assetId, attempt: job.attemptsMade, exhausted },
    `Image job ${finalStatus}: ${err.message}`,
  );

  try {
    await db
      .update(processingJobs)
      .set({
        status: finalStatus,
        // Truncate error message at 1000 chars; never log full stacks to DB columns
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

console.info(`Image worker started, listening on queue: ${QUEUE_NAMES.IMAGE_PROCESS}`);

// ── Graceful shutdown ──────────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  console.info({ signal }, 'Shutting down image worker');
  await worker.close();
  process.exit(0);
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
