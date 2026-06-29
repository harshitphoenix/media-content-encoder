import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { thumbnailEntries, type Database } from '@mce/db';
import { thumbnailKey, type StorageClient } from '@mce/storage';

const execFileAsync = promisify(execFile);

const PREVIEW_PERCENTS = [0.1, 0.25, 0.5, 0.75, 0.9] as const;
const TIMELINE_MAX_FRAMES = 100;
const THUMB_HEIGHT = 360;
const TIMELINE_HEIGHT = 90;

export interface ThumbnailOpts {
  assetId: string;
  originalStorageKey: string;
  durationSeconds: number;
  srcWidth: number;
  srcHeight: number;
  ffmpegPath: string;
}

export async function generateThumbnails(
  opts: ThumbnailOpts,
  db: Database,
  storage: StorageClient,
): Promise<void> {
  const { assetId, originalStorageKey, durationSeconds, srcWidth, srcHeight, ffmpegPath } = opts;

  const buf = await storage.download(storage.bucketOriginals, originalStorageKey);
  const inputPath = join(tmpdir(), `mce-thumb-input-${assetId}.mp4`);
  await writeFile(inputPath, buf);

  const workDir = await mkdirTmp(`mce-thumb-${assetId}-`);

  try {
    type ThumbRow = typeof thumbnailEntries.$inferInsert;
    const rows: ThumbRow[] = [];

    // Cover: 1 frame at 10% of duration
    const coverTs = Math.max(0, durationSeconds * 0.1);
    const coverFile = join(workDir, 'cover.jpg');
    await extractFrame(ffmpegPath, inputPath, coverTs, THUMB_HEIGHT, coverFile);
    const coverKey = thumbnailKey({ assetId, thumbnailType: 'cover', index: 0 });
    await storage.upload(storage.bucketVariants, coverKey, createReadStream(coverFile), {
      contentType: 'image/jpeg',
    });
    rows.push({
      assetId,
      thumbnailType: 'cover',
      storageKey: coverKey,
      width: scaleWidth(srcWidth, srcHeight, THUMB_HEIGHT),
      height: THUMB_HEIGHT,
      timestampSeconds: coverTs,
    });

    // Preview: 5 frames at evenly-spaced percentiles
    for (const [i, pct] of PREVIEW_PERCENTS.entries()) {
      const ts = Math.max(0, durationSeconds * pct);
      const previewFile = join(workDir, `preview_${i}.jpg`);
      await extractFrame(ffmpegPath, inputPath, ts, THUMB_HEIGHT, previewFile);
      const key = thumbnailKey({ assetId, thumbnailType: 'preview', index: i });
      await storage.upload(storage.bucketVariants, key, createReadStream(previewFile), {
        contentType: 'image/jpeg',
      });
      rows.push({
        assetId,
        thumbnailType: 'preview',
        storageKey: key,
        width: scaleWidth(srcWidth, srcHeight, THUMB_HEIGHT),
        height: THUMB_HEIGHT,
        timestampSeconds: ts,
      });
    }

    // Timeline: 1 frame per N seconds, max 100 frames
    const interval = Math.max(1, Math.ceil(durationSeconds / TIMELINE_MAX_FRAMES));
    const timelineDir = join(workDir, 'timeline');
    await mkdir(timelineDir);
    await execFileAsync(ffmpegPath, [
      '-i', inputPath,
      '-vf', `fps=1/${interval},scale=-2:${TIMELINE_HEIGHT}`,
      '-q:v', '5',
      '-y',
      join(timelineDir, 'frame_%04d.jpg'),
    ], { maxBuffer: 64 * 1024, timeout: 1800_000 });

    const frames = (await readdir(timelineDir)).sort();
    const timelineWidth = scaleWidth(srcWidth, srcHeight, TIMELINE_HEIGHT);
    for (let i = 0; i < frames.length; i++) {
      const framePath = join(timelineDir, frames[i]!);
      const key = thumbnailKey({ assetId, thumbnailType: 'timeline', index: i });
      await storage.upload(storage.bucketVariants, key, createReadStream(framePath), {
        contentType: 'image/jpeg',
      });
      rows.push({
        assetId,
        thumbnailType: 'timeline',
        storageKey: key,
        width: timelineWidth,
        height: TIMELINE_HEIGHT,
        timestampSeconds: i * interval,
      });
    }

    if (rows.length > 0) {
      await db.insert(thumbnailEntries).values(rows);
    }
  } finally {
    await Promise.allSettled([
      unlink(inputPath),
      rm(workDir, { recursive: true, force: true }),
    ]);
  }
}

async function extractFrame(
  ffmpegPath: string,
  inputPath: string,
  timestampSeconds: number,
  targetHeight: number,
  outputPath: string,
): Promise<void> {
  await execFileAsync(ffmpegPath, [
    '-ss', String(timestampSeconds),
    '-i', inputPath,
    '-vframes', '1',
    '-vf', `scale=-2:${targetHeight}`,
    '-q:v', '2',
    '-y',
    outputPath,
  ], { maxBuffer: 64 * 1024, timeout: 60_000 });
}

async function mkdirTmp(prefix: string): Promise<string> {
  const dir = join(tmpdir(), prefix);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Compute output width from source dimensions, rounded to nearest even number.
function scaleWidth(srcW: number, srcH: number, targetH: number): number {
  if (srcH <= 0) return 0;
  return Math.round((srcW * targetH) / srcH / 2) * 2;
}
