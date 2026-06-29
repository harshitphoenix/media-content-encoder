import type { FastifyPluginAsync } from 'fastify';

interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

interface MetricsResponse {
  queues: {
    imageProcess: QueueCounts;
    videoTranscode: QueueCounts;
  };
}

const metricsRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: MetricsResponse }>('/metrics', {}, async (_req, reply) => {
    const [imageProcess, videoTranscode] = await Promise.all([
      getQueueCounts(app.queues.imageProcess),
      getQueueCounts(app.queues.videoTranscode),
    ]);

    return reply.send({ queues: { imageProcess, videoTranscode } });
  });
};

async function getQueueCounts(queue: { getJobCounts(...states: string[]): Promise<Record<string, number>> }): Promise<QueueCounts> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  return {
    waiting: counts['waiting'] ?? 0,
    active: counts['active'] ?? 0,
    delayed: counts['delayed'] ?? 0,
    failed: counts['failed'] ?? 0,
    completed: counts['completed'] ?? 0,
  };
}

export default metricsRoute;
