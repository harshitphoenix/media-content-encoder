import type { FastifyPluginAsync } from 'fastify';
import { sql, gte, and, inArray } from 'drizzle-orm';
import { mediaAssets, processingJobs } from '@mce/db';

const TERMINAL_JOB_STATUSES = ['completed', 'dead'] as const;

const adminMetricsRoute: FastifyPluginAsync = async (app) => {
  app.get('/metrics', {}, async (_req, reply) => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Queue depths from BullMQ
    async function queueCounts(queue: (typeof app.queues)[keyof typeof app.queues]) {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      );
      return {
        waiting:   counts['waiting']   ?? 0,
        active:    counts['active']    ?? 0,
        delayed:   counts['delayed']   ?? 0,
        failed:    counts['failed']    ?? 0,
        completed: counts['completed'] ?? 0,
      };
    }

    // DB queries in parallel
    const [imageQ, videoQ, assetStats, recentCompleted, recentByStatus] = await Promise.all([
      queueCounts(app.queues.imageProcess),
      queueCounts(app.queues.videoTranscode),

      // Asset counts by status
      app.db
        .select({
          status: mediaAssets.status,
          count: sql<number>`count(*)::int`,
        })
        .from(mediaAssets)
        .groupBy(mediaAssets.status),

      // Throughput + avg duration (completed jobs in last hour)
      app.db
        .select({
          count: sql<number>`count(*)::int`,
          avgDurationMs: sql<number>`
            avg(
              extract(epoch from (completed_at - started_at)) * 1000
            )::float
          `,
        })
        .from(processingJobs)
        .where(
          and(
            inArray(processingJobs.status, [...TERMINAL_JOB_STATUSES]),
            gte(processingJobs.updatedAt, oneHourAgo),
          ),
        ),

      // Failure rate breakdown (last 24h)
      app.db
        .select({
          status: processingJobs.status,
          count: sql<number>`count(*)::int`,
        })
        .from(processingJobs)
        .where(gte(processingJobs.updatedAt, oneDayAgo))
        .groupBy(processingJobs.status),
    ]);

    // Compute failure rate from last-24h counts
    const statusCounts24h = Object.fromEntries(
      recentByStatus.map((r) => [r.status, r.count]),
    );
    const completed24h = (statusCounts24h['completed'] ?? 0) + (statusCounts24h['dead'] ?? 0);
    const failed24h = statusCounts24h['dead'] ?? 0;
    const failureRate24h =
      completed24h > 0 ? Number((failed24h / completed24h).toFixed(4)) : 0;

    const assetCounts = Object.fromEntries(assetStats.map((r) => [r.status, r.count]));
    const completedStats = recentCompleted[0];

    return reply.send({
      queues: {
        imageProcess: imageQ,
        videoTranscode: videoQ,
      },
      assets: {
        pending:    assetCounts['pending']    ?? 0,
        processing: assetCounts['processing'] ?? 0,
        ready:      assetCounts['ready']      ?? 0,
        failed:     assetCounts['failed']     ?? 0,
        total:      Object.values(assetCounts).reduce((s, n) => s + n, 0),
      },
      throughput: {
        completedJobsLastHour: completedStats?.count ?? 0,
        avgProcessingMs:
          completedStats?.avgDurationMs != null
            ? Math.round(completedStats.avgDurationMs)
            : null,
      },
      failureRate: {
        windowHours: 24,
        rate: failureRate24h,
        failedJobs: failed24h,
        totalTerminated: completed24h,
      },
    });
  });
};

export default adminMetricsRoute;
