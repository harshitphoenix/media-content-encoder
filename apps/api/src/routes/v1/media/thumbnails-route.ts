import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { mediaAssets, thumbnailEntries } from '@mce/db';

const thumbnailsRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    '/:id/thumbnails',
    {},
    async (req, reply) => {
      const { id } = req.params;

      const asset = await app.db.query.mediaAssets.findFirst({
        where: eq(mediaAssets.id, id),
        columns: { id: true, status: true },
      });

      if (!asset) {
        return reply.code(404).send({ error: 'Asset not found' });
      }

      const rows = await app.db
        .select()
        .from(thumbnailEntries)
        .where(eq(thumbnailEntries.assetId, id));

      const grouped: Record<string, unknown[]> = { cover: [], preview: [], timeline: [] };

      for (const t of rows) {
        const entry = {
          id: t.id,
          storageKey: t.storageKey,
          url: await app.storage.deliveryUrl(app.storage.bucketVariants, t.storageKey),
          width: t.width,
          height: t.height,
          timestampSeconds: t.timestampSeconds,
          createdAt: t.createdAt.toISOString(),
        };
        const bucket = grouped[t.thumbnailType];
        if (bucket) bucket.push(entry);
      }

      return reply.send({
        assetId: id,
        assetStatus: asset.status,
        thumbnails: grouped,
      });
    },
  );
};

export default thumbnailsRoute;
