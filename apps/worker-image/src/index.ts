import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type ImageProcessJobPayload } from '@mce/shared';

const redisUrl = process.env['REDIS_URL'];
if (!redisUrl) {
  console.error('REDIS_URL environment variable is required');
  process.exit(1);
}

// Parse Redis URL into ioredis connection options
const url = new URL(redisUrl);
const connection = {
  host: url.hostname,
  port: parseInt(url.port || '6379', 10),
  password: url.password || undefined,
  db: parseInt(url.pathname.slice(1) || '0', 10),
};

const worker = new Worker<ImageProcessJobPayload>(
  QUEUE_NAMES.IMAGE_PROCESS,
  async (job: Job<ImageProcessJobPayload>) => {
    console.info({ jobId: job.id, assetId: job.data.assetId }, 'Image processing job received');

    // TODO (Phase 3): implement image processing pipeline
    // - Download original from storage
    // - Extract metadata with sharp
    // - Generate multi-resolution variants (150, 320, 640, 1280, original)
    // - Convert to WebP, AVIF, JPEG
    // - Upload variants to storage
    // - Update DB variant records

    console.info({ jobId: job.id, assetId: job.data.assetId }, 'Image processing job complete (stub)');
  },
  {
    connection,
    concurrency: 5,
  },
);

worker.on('completed', (job) => {
  console.info({ jobId: job.id }, 'Job completed');
});

worker.on('failed', (job, err) => {
  console.error({ jobId: job?.id, err }, 'Job failed');
});

worker.on('error', (err) => {
  console.error({ err }, 'Worker error');
});

console.info(`Image worker started, listening on queue: ${QUEUE_NAMES.IMAGE_PROCESS}`);

const shutdown = async (signal: string) => {
  console.info({ signal }, 'Shutting down image worker');
  await worker.close();
  process.exit(0);
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
