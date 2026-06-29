import type { FastifyPluginAsync } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { schema } from '@mce/db';

const getRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/:id',
    {
      schema: {
        tags: ['Media'],
        summary: 'Get asset metadata by ID',
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
        with: {
          imageMetadata: true,
          videoMetadata: true,
          processingJobs: {
            orderBy: [desc(schema.processingJobs.createdAt)],
          },
        },
      });

      if (!asset) {
        return reply.code(404).send({ error: 'Asset not found.' });
      }

      let metadata: Record<string, unknown> | null = null;
      if (asset.imageMetadata) {
        metadata = {
          type: 'image',
          width: asset.imageMetadata.width,
          height: asset.imageMetadata.height,
          format: asset.imageMetadata.format,
          colorSpace: asset.imageMetadata.colorSpace,
          hasAlpha: asset.imageMetadata.hasAlpha,
        };
      } else if (asset.videoMetadata) {
        metadata = {
          type: 'video',
          width: asset.videoMetadata.width,
          height: asset.videoMetadata.height,
          durationSeconds: asset.videoMetadata.durationSeconds,
          codec: asset.videoMetadata.codec,
          fps: asset.videoMetadata.fps,
          bitrateBps: asset.videoMetadata.bitrateBps,
          audioCodec: asset.videoMetadata.audioCodec,
          audioChannels: asset.videoMetadata.audioChannels,
          audioSampleRateHz: asset.videoMetadata.audioSampleRateHz,
        };
      }

      return reply.send({
        id: asset.id,
        status: asset.status,
        mimeType: asset.mimeType,
        originalFilename: asset.originalFilename,
        sizeBytes: asset.sizeBytes,
        storageKey: asset.storageKey,
        metadata,
        jobs: asset.processingJobs.map((j) => ({
          id: j.id,
          type: j.jobType,
          status: j.status,
          attempts: j.attempts,
          maxAttempts: j.maxAttempts,
          createdAt: j.createdAt.toISOString(),
          updatedAt: j.updatedAt.toISOString(),
        })),
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
      });
    },
  );
};

export default getRoute;
