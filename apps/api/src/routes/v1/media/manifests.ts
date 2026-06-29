import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { mediaAssets, streamingManifests } from '@mce/db';

const manifestsRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    '/:id/manifests',
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
        .from(streamingManifests)
        .where(eq(streamingManifests.assetId, id));

      const manifests = rows.map(m => ({
        id: m.id,
        type: m.manifestType,
        storageKey: m.storageKey,
        url: m.cdnUrl ?? app.storage.cdnUrl(m.storageKey),
        createdAt: m.createdAt.toISOString(),
      }));

      return reply.send({
        assetId: id,
        assetStatus: asset.status,
        count: manifests.length,
        manifests,
      });
    },
  );
};

export default manifestsRoute;
