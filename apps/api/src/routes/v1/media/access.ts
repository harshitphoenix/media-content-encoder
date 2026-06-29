import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { mediaAssets, mediaVariants, streamingManifests, thumbnailEntries } from '@mce/db';

/**
 * GET /v1/media/:id/access
 *
 * Returns short-lived presigned download URLs for all processed variants of an asset.
 * Each URL expires after CDN_URL_TTL_SECONDS (default 1 hour).
 *
 * HLS/DASH manifests always use plain CDN URLs regardless of SIGNED_URLS setting,
 * since presigned URLs break relative segment resolution in media players.
 */
const accessRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    '/:id/access',
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

      if (asset.status !== 'ready') {
        return reply.code(409).send({
          error: 'Asset is not ready',
          status: asset.status,
        });
      }

      // Fetch all related data in parallel
      const [variantRows, manifestRows, thumbnailRows] = await Promise.all([
        app.db
          .select({
            id: mediaVariants.id,
            variantType: mediaVariants.variantType,
            format: mediaVariants.format,
            width: mediaVariants.width,
            height: mediaVariants.height,
            sizeBytes: mediaVariants.sizeBytes,
            storageKey: mediaVariants.storageKey,
          })
          .from(mediaVariants)
          .where(eq(mediaVariants.assetId, id)),
        app.db
          .select({
            id: streamingManifests.id,
            manifestType: streamingManifests.manifestType,
            storageKey: streamingManifests.storageKey,
          })
          .from(streamingManifests)
          .where(eq(streamingManifests.assetId, id)),
        app.db
          .select({
            id: thumbnailEntries.id,
            thumbnailType: thumbnailEntries.thumbnailType,
            storageKey: thumbnailEntries.storageKey,
            width: thumbnailEntries.width,
            height: thumbnailEntries.height,
            timestampSeconds: thumbnailEntries.timestampSeconds,
          })
          .from(thumbnailEntries)
          .where(eq(thumbnailEntries.assetId, id)),
      ]);

      // Generate presigned variant URLs (always presigned in /access)
      const variants = await Promise.all(
        variantRows.map(async (v) => ({
          id: v.id,
          variantType: v.variantType,
          format: v.format,
          width: v.width,
          height: v.height,
          sizeBytes: Number(v.sizeBytes),
          url: await app.storage.signedUrl(app.storage.bucketVariants, v.storageKey),
        })),
      );

      // HLS/DASH manifests: always CDN URL (presigned breaks relative segment resolution)
      const manifests = manifestRows.map((m) => ({
        id: m.id,
        type: m.manifestType,
        url: app.storage.cdnUrl(m.storageKey),
      }));

      // Thumbnails: presigned for direct download
      const thumbnails = await Promise.all(
        thumbnailRows.map(async (t) => ({
          id: t.id,
          thumbnailType: t.thumbnailType,
          width: t.width,
          height: t.height,
          timestampSeconds: t.timestampSeconds,
          url: await app.storage.signedUrl(app.storage.bucketVariants, t.storageKey),
        })),
      );

      return reply.send({
        assetId: id,
        variants,
        manifests,
        thumbnails,
      });
    },
  );
};

export default accessRoute;
