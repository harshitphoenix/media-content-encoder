import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type VideoTranscodeJobPayload } from '@mce/shared';

const redisUrl = process.env['REDIS_URL'];
if (!redisUrl) {
  console.error('REDIS_URL environment variable is required');
  process.exit(1);
}

const url = new URL(redisUrl);
const connection = {
  host: url.hostname,
  port: parseInt(url.port || '6379', 10),
  password: url.password || undefined,
  db: parseInt(url.pathname.slice(1) || '0', 10),
};

// Video worker handles multiple queues
const transcodingWorker = new Worker<VideoTranscodeJobPayload>(
  QUEUE_NAMES.VIDEO_TRANSCODE,
  async (job: Job<VideoTranscodeJobPayload>) => {
    console.info({ jobId: job.id, assetId: job.data.assetId }, 'Video transcode job received');

    // TODO (Phase 4): implement video transcoding pipeline
    // - Download original from storage
    // - Probe with ffprobe to extract metadata
    // - Generate renditions: 240p, 360p, 480p, 720p, 1080p
    // - Apply H.264/H.265 + AAC codec settings with bitrate ladders
    // - Upload renditions to storage
    // - Update DB variant records
    // - Trigger thumbnail generation job (Phase 5)
    // - Trigger manifest generation job (Phase 5)

    console.info({ jobId: job.id, assetId: job.data.assetId }, 'Video transcode job complete (stub)');
  },
  {
    connection,
    concurrency: 2, // Video transcoding is CPU-intensive
  },
);

transcodingWorker.on('completed', (job) => {
  console.info({ jobId: job.id }, 'Transcode job completed');
});

transcodingWorker.on('failed', (job, err) => {
  console.error({ jobId: job?.id, err }, 'Transcode job failed');
});

transcodingWorker.on('error', (err) => {
  console.error({ err }, 'Transcoding worker error');
});

console.info(`Video worker started, listening on queue: ${QUEUE_NAMES.VIDEO_TRANSCODE}`);

const shutdown = async (signal: string) => {
  console.info({ signal }, 'Shutting down video worker');
  await transcodingWorker.close();
  process.exit(0);
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
