import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  mediaAssets,
  mediaVariants,
  processingJobs,
  streamingManifests,
  thumbnailEntries,
} from '@mce/db';
import { isImageMimeType, JOB_TYPE, QUEUE_NAMES } from '@mce/shared';

const IN_FLIGHT_STATUSES = new Set(['queued', 'processing']);

const reprocessRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>('/:id/reprocess', {}, async (req, reply) => {
    const { id } = req.params;

    const asset = await app.db.query.mediaAssets.findFirst({
      where: eq(mediaAssets.id, id),
      columns: { id: true, status: true, mimeType: true, storageKey: true },
    });

    if (!asset) {
      return reply.code(404).send({ error: 'Asset not found' });
    }

    if (IN_FLIGHT_STATUSES.has(asset.status)) {
      return reply.code(409).send({
        error: 'Asset is currently being processed — wait for it to finish before reprocessing',
        status: asset.status,
      });
    }

    // ── 1. Collect all derived storage keys ──────────────────────────────────
    const [variantRows, thumbnailRows, manifestListHls, manifestListDash] = await Promise.all([
      app.db
        .select({ storageKey: mediaVariants.storageKey })
        .from(mediaVariants)
        .where(eq(mediaVariants.assetId, id)),

      app.db
        .select({ storageKey: thumbnailEntries.storageKey })
        .from(thumbnailEntries)
        .where(eq(thumbnailEntries.assetId, id)),

      // HLS segment files are not individually tracked — list by prefix
      app.storage.listObjects(app.storage.bucketVariants, `manifests/${id}/hls/`),
      app.storage.listObjects(app.storage.bucketVariants, `manifests/${id}/dash/`),
    ]);

    const variantKeys = variantRows.map((r) => r.storageKey);
    const thumbnailKeys = thumbnailRows.map((r) => r.storageKey);
    const allVariantBucketKeys = [
      ...variantKeys,
      ...thumbnailKeys,
      ...manifestListHls,
      ...manifestListDash,
    ];

    // ── 2. Delete from storage, then from DB ──────────────────────────────────
    await app.storage.deleteMany(app.storage.bucketVariants, allVariantBucketKeys);

    await Promise.all([
      app.db.delete(mediaVariants).where(eq(mediaVariants.assetId, id)),
      app.db.delete(streamingManifests).where(eq(streamingManifests.assetId, id)),
      app.db.delete(thumbnailEntries).where(eq(thumbnailEntries.assetId, id)),
    ]);

    // ── 3. Reset asset to pending ─────────────────────────────────────────────
    const now = new Date();
    await app.db
      .update(mediaAssets)
      .set({ status: 'pending', updatedAt: now })
      .where(eq(mediaAssets.id, id));

    // ── 4. Create new processingJob ───────────────────────────────────────────
    const isImage = isImageMimeType(asset.mimeType);
    const jobType = isImage ? JOB_TYPE.IMAGE_PROCESS : JOB_TYPE.VIDEO_TRANSCODE;

    const [newJob] = await app.db
      .insert(processingJobs)
      .values({
        assetId: id,
        jobType,
        status: 'pending',
        maxAttempts: app.config.JOB_MAX_ATTEMPTS,
      })
      .returning({ id: processingJobs.id });

    if (!newJob) throw new Error('Failed to create processing job');

    // ── 5. Enqueue the new job ────────────────────────────────────────────────
    const queue = isImage ? app.queues.imageProcess : app.queues.videoTranscode;
    const queueName = isImage ? QUEUE_NAMES.IMAGE_PROCESS : QUEUE_NAMES.VIDEO_TRANSCODE;
    const payload = { assetId: id, storageKey: asset.storageKey, mimeType: asset.mimeType };

    try {
      await queue.add(queueName, payload, {
        jobId: newJob.id,
        attempts: app.config.JOB_MAX_ATTEMPTS,
        backoff: { type: 'exponential' as const, delay: app.config.JOB_BACKOFF_BASE_MS },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: false,
      });

      const queuedAt = new Date();
      await app.db
        .update(processingJobs)
        .set({ status: 'queued', queuedAt, updatedAt: queuedAt })
        .where(eq(processingJobs.id, newJob.id));
    } catch (queueErr) {
      req.log.warn(
        { err: queueErr, jobId: newJob.id, assetId: id },
        'Failed to enqueue reprocess job — job remains pending',
      );
    }

    req.log.info(
      { audit: true, action: 'admin.reprocess', assetId: id, jobId: newJob.id, ip: req.ip },
      'Admin triggered asset reprocess',
    );

    return reply.code(202).send({ assetId: id, jobId: newJob.id, status: 'queued' });
  });
};

export default reprocessRoute;
