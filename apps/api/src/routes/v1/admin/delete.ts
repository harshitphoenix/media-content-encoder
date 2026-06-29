import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  mediaAssets,
  mediaVariants,
  streamingManifests,
  thumbnailEntries,
} from '@mce/db';

const deleteRoute: FastifyPluginAsync = async (app) => {
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (req, reply) => {
    const { id } = req.params;

    const asset = await app.db.query.mediaAssets.findFirst({
      where: eq(mediaAssets.id, id),
      columns: { id: true, storageKey: true, status: true },
    });

    if (!asset) {
      return reply.code(404).send({ error: 'Asset not found' });
    }

    // ── 1. Collect all storage keys (across both buckets) ────────────────────
    const [variantRows, thumbnailRows, manifestListHls, manifestListDash] = await Promise.all([
      app.db
        .select({ storageKey: mediaVariants.storageKey })
        .from(mediaVariants)
        .where(eq(mediaVariants.assetId, id)),

      app.db
        .select({ storageKey: thumbnailEntries.storageKey })
        .from(thumbnailEntries)
        .where(eq(thumbnailEntries.assetId, id)),

      app.storage.listObjects(app.storage.bucketVariants, `manifests/${id}/hls/`),
      app.storage.listObjects(app.storage.bucketVariants, `manifests/${id}/dash/`),
    ]);

    const variantBucketKeys = [
      ...variantRows.map((r) => r.storageKey),
      ...thumbnailRows.map((r) => r.storageKey),
      ...manifestListHls,
      ...manifestListDash,
    ];

    // ── 2. Delete from storage (originals bucket + variants bucket) ───────────
    await Promise.all([
      app.storage.delete(app.storage.bucketOriginals, asset.storageKey),
      app.storage.deleteMany(app.storage.bucketVariants, variantBucketKeys),
    ]);

    // ── 3. Delete from DB — cascade removes all related records ───────────────
    await app.db.delete(mediaAssets).where(eq(mediaAssets.id, id));

    req.log.info(
      {
        audit: true,
        action: 'admin.delete',
        assetId: id,
        variantsDeleted: variantBucketKeys.length,
        ip: req.ip,
      },
      'Admin deleted asset',
    );

    return reply.code(204).send();
  });
};

export default deleteRoute;
