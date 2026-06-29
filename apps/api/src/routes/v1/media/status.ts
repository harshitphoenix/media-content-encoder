import type { FastifyPluginAsync } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { schema } from '@mce/db';

const statusRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/:id/status',
    {
      schema: {
        tags: ['Media'],
        summary: 'Get processing job status for an asset',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const asset = await app.db.query.mediaAssets.findFirst({
        where: eq(schema.mediaAssets.id, id),
        columns: { id: true, status: true },
        with: {
          processingJobs: {
            orderBy: [desc(schema.processingJobs.createdAt)],
          },
        },
      });

      if (!asset) {
        return reply.code(404).send({ error: 'Asset not found.' });
      }

      return reply.send({
        assetId: asset.id,
        assetStatus: asset.status,
        jobs: asset.processingJobs.map((j) => ({
          id: j.id,
          type: j.jobType,
          status: j.status,
          attempts: j.attempts,
          maxAttempts: j.maxAttempts,
          errorMessage: j.errorMessage,
          queuedAt: j.queuedAt?.toISOString() ?? null,
          startedAt: j.startedAt?.toISOString() ?? null,
          completedAt: j.completedAt?.toISOString() ?? null,
          createdAt: j.createdAt.toISOString(),
          updatedAt: j.updatedAt.toISOString(),
        })),
      });
    },
  );
};

export default statusRoute;
