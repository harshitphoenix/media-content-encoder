import type { FastifyPluginAsync } from 'fastify';
import { eq, asc } from 'drizzle-orm';
import { mediaAssets, mediaVariants } from '@mce/db';

const variantsRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    '/:id/variants',
    {},
    async (req, reply) => {
      const { id } = req.params;

      // Verify asset exists
      const asset = await app.db.query.mediaAssets.findFirst({
        where: eq(mediaAssets.id, id),
        columns: { id: true, status: true },
      });

      if (!asset) {
        return reply.code(404).send({ error: 'Asset not found' });
      }

      const rows = await app.db
        .select()
        .from(mediaVariants)
        .where(eq(mediaVariants.assetId, id))
        .orderBy(asc(mediaVariants.variantType), asc(mediaVariants.format));

      const variants = rows.map(v => ({
        id: v.id,
        variantType: v.variantType,
        format: v.format,
        width: v.width,
        height: v.height,
        sizeBytes: Number(v.sizeBytes),
        storageKey: v.storageKey,
        url: app.storage.cdnUrl(v.storageKey),
        createdAt: v.createdAt.toISOString(),
      }));

      return reply.send({
        assetId: id,
        assetStatus: asset.status,
        count: variants.length,
        variants,
      });
    },
  );
};

export default variantsRoute;
