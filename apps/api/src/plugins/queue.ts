import fp from 'fastify-plugin';
import { Queue } from 'bullmq';
import type { FastifyPluginAsync } from 'fastify';
import type { ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES } from '@mce/shared';

export type AppQueues = {
  imageProcess: Queue;
  videoTranscode: Queue;
};

declare module 'fastify' {
  interface FastifyInstance {
    queues: AppQueues;
  }
}

function parseRedisUrl(urlString: string): ConnectionOptions {
  const u = new URL(urlString);
  return {
    host: u.hostname,
    port: parseInt(u.port || '6379', 10),
    password: u.password || undefined,
    db: parseInt(u.pathname.slice(1) || '0', 10),
    maxRetriesPerRequest: null, // required by BullMQ
  };
}

const queuePlugin: FastifyPluginAsync = fp(async (app) => {
  const connection = parseRedisUrl(app.config.REDIS_URL);

  const imageProcess = new Queue(QUEUE_NAMES.IMAGE_PROCESS, { connection });
  const videoTranscode = new Queue(QUEUE_NAMES.VIDEO_TRANSCODE, { connection });

  app.decorate('queues', { imageProcess, videoTranscode });

  app.addHook('onClose', async () => {
    await Promise.allSettled([imageProcess.close(), videoTranscode.close()]);
    app.log.info('Job queues closed');
  });

  app.log.info('Job queues initialized');
});

export { parseRedisUrl };
export default queuePlugin;
