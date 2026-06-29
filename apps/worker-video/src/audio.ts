import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { mediaVariants, type Database } from '@mce/db';
import { type StorageClient } from '@mce/storage';

const execFileAsync = promisify(execFile);

const AUDIO_KEY = (assetId: string) => `variants/${assetId}/audio_normalized.mp3`;

export async function extractAudio(
  opts: { assetId: string; jobId: string; originalStorageKey: string },
  db: Database,
  storage: StorageClient,
  ffmpegPath: string,
): Promise<void> {
  const { assetId, jobId, originalStorageKey } = opts;

  const buf = await storage.download(storage.bucketOriginals, originalStorageKey);
  const inputPath = join(tmpdir(), `mce-audio-input-${assetId}.mp4`);
  const outputPath = join(tmpdir(), `mce-audio-output-${assetId}.mp3`);
  await writeFile(inputPath, buf);

  try {
    await execFileAsync(ffmpegPath, [
      '-i', inputPath,
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-y',
      outputPath,
    ], { maxBuffer: 64 * 1024, timeout: 3600_000 });

    const { size } = await stat(outputPath);
    const key = AUDIO_KEY(assetId);

    await storage.upload(storage.bucketVariants, key, createReadStream(outputPath), {
      contentType: 'audio/mpeg',
    });

    await db.insert(mediaVariants).values({
      assetId,
      jobId,
      variantType: 'audio_normalized',
      format: 'mp3',
      sizeBytes: size,
      storageKey: key,
    });
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}
