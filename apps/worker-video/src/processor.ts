import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { mediaVariants, videoMetadata, type Database } from '@mce/db';
import { VIDEO_RENDITIONS, type VideoRenditionLabel, type VideoTranscodeJobPayload } from '@mce/shared';
import { StorageClient, variantKey } from '@mce/storage';

const execFileAsync = promisify(execFile);

// ── Rendition configuration ────────────────────────────────────────────────────

interface RenditionSpec {
  label: VideoRenditionLabel;
  variantType: `video_${VideoRenditionLabel}`;
  targetHeight: number;
  targetWidth: number;
  crf: number;
  maxBitrateBps: number;
  audioBitrateBps: number;
}

const RENDITION_SPECS: RenditionSpec[] = [
  { label: '240p',  variantType: 'video_240p',  targetHeight: 240,  targetWidth: 426,  crf: 28, maxBitrateBps: VIDEO_RENDITIONS['240p'].maxBitrate,  audioBitrateBps: 96_000  },
  { label: '360p',  variantType: 'video_360p',  targetHeight: 360,  targetWidth: 640,  crf: 26, maxBitrateBps: VIDEO_RENDITIONS['360p'].maxBitrate,  audioBitrateBps: 128_000 },
  { label: '480p',  variantType: 'video_480p',  targetHeight: 480,  targetWidth: 854,  crf: 24, maxBitrateBps: VIDEO_RENDITIONS['480p'].maxBitrate,  audioBitrateBps: 128_000 },
  { label: '720p',  variantType: 'video_720p',  targetHeight: 720,  targetWidth: 1280, crf: 22, maxBitrateBps: VIDEO_RENDITIONS['720p'].maxBitrate,  audioBitrateBps: 192_000 },
  { label: '1080p', variantType: 'video_1080p', targetHeight: 1080, targetWidth: 1920, crf: 21, maxBitrateBps: VIDEO_RENDITIONS['1080p'].maxBitrate, audioBitrateBps: 192_000 },
];

// ── Core processing function ──────────────────────────────────────────────────

export async function transcodeVideoJob(
  job: { id: string; data: VideoTranscodeJobPayload },
  db: Database,
  storage: StorageClient,
  ffmpegPath: string,
): Promise<void> {
  const { assetId, storageKey: originalStorageKey } = job.data;

  // 1. Look up source dimensions from DB (set during Phase 1 upload)
  const srcMeta = await db.query.videoMetadata.findFirst({
    where: eq(videoMetadata.assetId, assetId),
    columns: { width: true, height: true },
  });
  if (!srcMeta) throw new Error(`No video metadata found for asset ${assetId}`);

  // 2. Download original to a temp file (ffmpeg needs a file path, not a buffer)
  const originalBuffer = await storage.download(storage.bucketOriginals, originalStorageKey);
  const inputPath = join(tmpdir(), `mce-input-${job.id}.mp4`);
  await writeFile(inputPath, originalBuffer);

  const tempOutputPaths: string[] = [];

  try {
    // 3. Determine which renditions to generate (never upscale)
    const renditionsToRun = RENDITION_SPECS.filter(r => r.targetHeight <= srcMeta.height);

    if (renditionsToRun.length === 0) {
      console.warn({ jobId: job.id, assetId, srcHeight: srcMeta.height }, 'Source video smaller than all renditions — skipping transcoding');
    }

    // 4. Transcode each rendition sequentially (video encoding is CPU-intensive)
    const variantRecords: Array<{
      assetId: string;
      jobId: string;
      variantType: RenditionSpec['variantType'];
      format: 'mp4';
      width: number;
      height: number;
      sizeBytes: number;
      storageKey: string;
    }> = [];

    for (const spec of renditionsToRun) {
      const outputPath = join(tmpdir(), `mce-output-${job.id}-${spec.label}.mp4`);
      tempOutputPaths.push(outputPath);

      const { width, height } = computeOutputDimensions(srcMeta.width, srcMeta.height, spec.targetHeight);
      const maxRateK = Math.floor(spec.maxBitrateBps / 1000);
      const bufSizeK = maxRateK * 2;
      const audioBitK = Math.floor(spec.audioBitrateBps / 1000);

      // Scale to target height; -2 ensures width is divisible by 2 for libx264
      const scaleFilter = `scale=-2:${spec.targetHeight}`;

      console.info({ jobId: job.id, assetId, rendition: spec.label }, 'Starting transcode');

      await execFileAsync(ffmpegPath, [
        '-i', inputPath,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', String(spec.crf),
        '-maxrate', `${maxRateK}k`,
        '-bufsize', `${bufSizeK}k`,
        '-vf', scaleFilter,
        '-c:a', 'aac',
        '-b:a', `${audioBitK}k`,
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ], {
        maxBuffer: 256 * 1024, // ffmpeg writes progress to stderr; stdout is minimal
        timeout: 3600_000,     // 1 hour hard cap per rendition
      });

      const { size } = await stat(outputPath);

      const key = variantKey({ assetId, variantType: spec.variantType, format: 'mp4' });
      await storage.upload(storage.bucketVariants, key, createReadStream(outputPath), {
        contentType: 'video/mp4',
      });

      variantRecords.push({
        assetId,
        jobId: job.id,
        variantType: spec.variantType,
        format: 'mp4',
        width,
        height,
        sizeBytes: size,
        storageKey: key,
      });

      console.info({ jobId: job.id, assetId, rendition: spec.label, sizeBytes: size }, 'Rendition uploaded');
    }

    // 5. Batch-insert all variant rows (only after all uploads succeed)
    if (variantRecords.length > 0) {
      await db.insert(mediaVariants).values(variantRecords);
    }

  } finally {
    // Clean up all temp files regardless of success or failure
    const cleanups = [inputPath, ...tempOutputPaths].map(p =>
      unlink(p).catch(() => undefined),
    );
    await Promise.all(cleanups);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute output dimensions that fit within targetHeight, preserving aspect
 * ratio, with width rounded to the nearest even number (required by libx264).
 */
function computeOutputDimensions(
  srcW: number,
  srcH: number,
  targetH: number,
): { width: number; height: number } {
  if (srcH <= targetH) return { width: srcW, height: srcH };
  const scale = targetH / srcH;
  const rawW = srcW * scale;
  const width = Math.round(rawW / 2) * 2;
  return { width, height: targetH };
}
