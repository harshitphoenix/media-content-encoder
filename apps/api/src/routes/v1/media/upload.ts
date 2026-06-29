import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { mediaAssets, imageMetadata, videoMetadata, processingJobs } from '@mce/db';
import { isImageMimeType, JOB_TYPE, UploadQuerySchema, type CropParams } from '@mce/shared';
import { originalKey } from '@mce/storage';
import {
  detectFileType,
  assertSupportedMimeType,
  assertFileSizeLimit,
  assertImageDimensions,
  assertVideoDuration,
  ValidationError,
  probeImage,
  probeVideo,
  ImageProbeError,
  VideoProbeError,
} from '../../../services/index.js';

const uploadRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/',
    {},
    async (req, reply) => {
      const upload = await req.saveUpload();

      try {
        // ── 1. Detect real MIME type from magic bytes ──────────────────────
        const detectedMime = await detectFileType(upload.filePath);
        const mimeType = assertSupportedMimeType(detectedMime);

        // ── 2. Validate file size against per-type limit ───────────────────
        const sizeBytes = await assertFileSizeLimit(upload.filePath, mimeType);

        // ── 3. Probe and validate media-specific constraints ───────────────
        const assetId = randomUUID();
        const isImage = isImageMimeType(mimeType);

        let imgMeta: {
          assetId: string; width: number; height: number; format: string;
          colorSpace: string | null; hasAlpha: boolean;
        } | null = null;

        let vidMeta: {
          assetId: string; width: number; height: number; durationSeconds: number;
          codec: string; fps: number; bitrateBps: number; audioCodec: string | null;
          audioChannels: number | null; audioSampleRateHz: number | null;
        } | null = null;

        let metadataResponseBlock: Record<string, unknown>;
        let crop: CropParams | undefined;

        if (isImage) {
          let probe;
          try {
            probe = await probeImage(upload.filePath);
          } catch (err) {
            if (err instanceof ImageProbeError) {
              return reply.code(422).send({ error: 'The uploaded image file appears to be corrupt or malformed.' });
            }
            throw err;
          }
          assertImageDimensions(probe.width, probe.height);
          imgMeta = { assetId, width: probe.width, height: probe.height, format: probe.format, colorSpace: probe.colorSpace, hasAlpha: probe.hasAlpha };
          metadataResponseBlock = { type: 'image', width: probe.width, height: probe.height, format: probe.format, colorSpace: probe.colorSpace, hasAlpha: probe.hasAlpha };

          // Parse and validate optional crop params against actual image dimensions
          const queryResult = UploadQuerySchema.safeParse(req.query);
          if (!queryResult.success) {
            return reply.code(400).send({ error: 'Invalid crop parameters: ' + queryResult.error.issues.map(i => i.message).join(', ') });
          }
          const { cropX, cropY, cropWidth, cropHeight } = queryResult.data;
          if (cropX !== undefined || cropY !== undefined || cropWidth !== undefined || cropHeight !== undefined) {
            const x = cropX ?? 0;
            const y = cropY ?? 0;
            const w = cropWidth ?? (probe.width - x);
            const h = cropHeight ?? (probe.height - y);
            if (x + w > probe.width || y + h > probe.height || w <= 0 || h <= 0) {
              return reply.code(400).send({ error: `Crop region (${x},${y} ${w}×${h}) exceeds image dimensions ${probe.width}×${probe.height}` });
            }
            crop = { x, y, width: w, height: h };
          }
        } else {
          let probe;
          try {
            probe = await probeVideo(upload.filePath, req.server.config.FFPROBE_PATH);
          } catch (err) {
            if (err instanceof VideoProbeError) {
              const msg = (err as VideoProbeError).message.includes('ffprobe not found')
                ? 'Video processing is not available on this server.'
                : 'The uploaded video file appears to be corrupt or malformed.';
              return reply.code(422).send({ error: msg });
            }
            throw err;
          }
          assertVideoDuration(probe.durationSeconds);
          vidMeta = { assetId, width: probe.width, height: probe.height, durationSeconds: probe.durationSeconds, codec: probe.codec, fps: probe.fps, bitrateBps: probe.bitrateBps, audioCodec: probe.audioCodec, audioChannels: probe.audioChannels, audioSampleRateHz: probe.audioSampleRateHz };
          metadataResponseBlock = { type: 'video', width: probe.width, height: probe.height, durationSeconds: probe.durationSeconds, codec: probe.codec, fps: probe.fps, bitrateBps: probe.bitrateBps, audioCodec: probe.audioCodec, audioChannels: probe.audioChannels, audioSampleRateHz: probe.audioSampleRateHz };
        }

        // ── 4. Build storage key and upload original ───────────────────────
        const storageKey = originalKey({ assetId, mimeType });
        await req.server.storage.upload(
          req.server.storage.bucketOriginals,
          storageKey,
          createReadStream(upload.filePath),
          { contentType: mimeType, metadata: { originalFilename: upload.filename } },
        );

        // ── 5. Persist to DB in a transaction ─────────────────────────────
        const now = new Date();
        const { asset, job } = await req.server.db.transaction(async (tx) => {
          const inserted = await tx.insert(mediaAssets).values({
            id: assetId,
            ownerId: null,
            mimeType,
            originalFilename: upload.filename,
            sizeBytes,
            status: 'pending',
            storageKey,
            createdAt: now,
            updatedAt: now,
          }).returning();
          const insertedAsset = inserted[0];
          if (!insertedAsset) throw new Error('Asset insert returned no row');

          if (imgMeta) {
            await tx.insert(imageMetadata).values(imgMeta);
          } else if (vidMeta) {
            await tx.insert(videoMetadata).values(vidMeta);
          }

          const jobType = isImage ? JOB_TYPE.IMAGE_PROCESS : JOB_TYPE.VIDEO_TRANSCODE;
          const insertedJobs = await tx.insert(processingJobs).values({
            assetId,
            jobType,
            status: 'pending',
            attempts: 0,
            maxAttempts: req.server.config.JOB_MAX_ATTEMPTS,
            createdAt: now,
            updatedAt: now,
          }).returning();
          const insertedJob = insertedJobs[0];
          if (!insertedJob) throw new Error('Job insert returned no row');

          return { asset: insertedAsset, job: insertedJob };
        });

        // ── 6. Enqueue job (best-effort — Redis failure doesn't abort upload) ─
        const jobEnvelope = { assetId, storageKey, mimeType, ...(crop ? { crop } : {}) };
        const queueOpts = {
          jobId: job.id, // idempotency: BullMQ deduplicates on waiting/active/delayed
          attempts: req.server.config.JOB_MAX_ATTEMPTS,
          backoff: { type: 'exponential' as const, delay: req.server.config.JOB_BACKOFF_BASE_MS },
          removeOnComplete: { age: 24 * 3600 },
          removeOnFail: false,
        };
        try {
          if (isImage) {
            await req.server.queues.imageProcess.add('process', jobEnvelope, queueOpts);
          } else {
            await req.server.queues.videoTranscode.add('transcode', jobEnvelope, queueOpts);
          }
          const queuedAt = new Date();
          await req.server.db
            .update(processingJobs)
            .set({ status: 'queued', queuedAt, updatedAt: queuedAt })
            .where(eq(processingJobs.id, job.id));
        } catch (queueErr) {
          req.log.warn({ err: queueErr, jobId: job.id }, 'Failed to enqueue job — job remains in pending state');
        }

        // ── 7. Respond ─────────────────────────────────────────────────────
        return reply.code(201).send({
          id: asset.id,
          status: asset.status,
          mimeType: asset.mimeType,
          originalFilename: asset.originalFilename,
          sizeBytes: asset.sizeBytes,
          storageKey: asset.storageKey,
          metadata: metadataResponseBlock,
          jobId: job.id,
          createdAt: asset.createdAt.toISOString(),
        });
      } catch (err) {
        if (err instanceof ValidationError) {
          return reply.code(400).send({ error: err.message });
        }
        req.log.error({ err }, 'Upload pipeline failed');
        throw err;
      } finally {
        await upload.cleanup();
      }
    },
  );
};

export default uploadRoute;
