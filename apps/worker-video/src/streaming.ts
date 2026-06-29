import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq, like } from 'drizzle-orm';
import { mediaVariants, streamingManifests, videoMetadata, type Database } from '@mce/db';
import { manifestKey, type StorageClient } from '@mce/storage';

const execFileAsync = promisify(execFile);

const HLS_SEGMENT_DURATION = 6;
const DASH_SEGMENT_DURATION = 6;

const BANDWIDTH_BY_VARIANT_TYPE: Record<string, number> = {
  video_240p:  800_000,
  video_360p:  1_200_000,
  video_480p:  2_500_000,
  video_720p:  5_000_000,
  video_1080p: 8_000_000,
};

// ── HLS ─────────────────────────────────────────────────────────────────────

export async function generateHlsManifest(
  opts: { assetId: string },
  db: Database,
  storage: StorageClient,
  ffmpegPath: string,
): Promise<void> {
  const { assetId } = opts;

  const variants = await db
    .select({
      variantType: mediaVariants.variantType,
      storageKey: mediaVariants.storageKey,
      width: mediaVariants.width,
      height: mediaVariants.height,
    })
    .from(mediaVariants)
    .where(and(eq(mediaVariants.assetId, assetId), like(mediaVariants.variantType, 'video_%')))
    .orderBy(mediaVariants.height);

  if (variants.length === 0) return;

  const hlsWorkDir = join(tmpdir(), `mce-hls-${assetId}`);
  await mkdir(hlsWorkDir, { recursive: true });
  const inputPaths: string[] = [];

  try {
    const renditionInfos: Array<{
      variantType: string;
      playlistFilename: string;
      width: number | null;
      height: number | null;
      bandwidth: number;
    }> = [];

    for (const v of variants) {
      // Download each transcoded MP4 to a temp path outside hlsWorkDir
      const buf = await storage.download(storage.bucketVariants, v.storageKey);
      const inputPath = join(tmpdir(), `mce-hls-input-${assetId}-${v.variantType}.mp4`);
      await writeFile(inputPath, buf);
      inputPaths.push(inputPath);

      const playlistFilename = `${v.variantType}.m3u8`;
      const segFilename = `${v.variantType}_seg_%04d.ts`;

      await execFileAsync(ffmpegPath, [
        '-i', inputPath,
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', String(HLS_SEGMENT_DURATION),
        '-hls_list_size', '0',
        '-hls_segment_filename', segFilename,
        '-hls_flags', 'independent_segments',
        '-y',
        playlistFilename,
      ], { cwd: hlsWorkDir, maxBuffer: 64 * 1024, timeout: 3600_000 });

      renditionInfos.push({
        variantType: v.variantType,
        playlistFilename,
        width: v.width,
        height: v.height,
        bandwidth: BANDWIDTH_BY_VARIANT_TYPE[v.variantType] ?? 1_000_000,
      });
    }

    // Build and write master playlist
    const masterContent = buildHlsMasterPlaylist(renditionInfos);
    await writeFile(join(hlsWorkDir, 'index.m3u8'), masterContent);

    // Upload all generated files
    const allFiles = await readdir(hlsWorkDir);
    await Promise.all(
      allFiles.map(async (filename) => {
        const filePath = join(hlsWorkDir, filename);
        const storageKey = `manifests/${assetId}/hls/${filename}`;
        const isPlaylist = filename.endsWith('.m3u8');
        await storage.upload(storage.bucketVariants, storageKey, createReadStream(filePath), {
          contentType: isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
          cacheControl: isPlaylist
            ? 'public, max-age=30'                    // playlists may be regenerated
            : 'public, max-age=31536000, immutable',  // segments are content-addressed
        });
      }),
    );

    const masterKey = manifestKey({ assetId, manifestType: 'hls' });
    await db.insert(streamingManifests).values({
      assetId,
      manifestType: 'hls',
      storageKey: masterKey,
      cdnUrl: storage.cdnUrl(masterKey),
    });
  } finally {
    await Promise.allSettled([
      rm(hlsWorkDir, { recursive: true, force: true }),
      ...inputPaths.map(p => unlink(p)),
    ]);
  }
}

function buildHlsMasterPlaylist(
  renditions: Array<{
    variantType: string;
    playlistFilename: string;
    width: number | null;
    height: number | null;
    bandwidth: number;
  }>,
): string {
  const sorted = [...renditions].sort((a, b) => (a.bandwidth ?? 0) - (b.bandwidth ?? 0));
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];

  for (const r of sorted) {
    const resolution =
      r.width != null && r.height != null ? `,RESOLUTION=${r.width}x${r.height}` : '';
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth}${resolution}`);
    lines.push(r.playlistFilename);
  }

  return lines.join('\n') + '\n';
}

// ── DASH ─────────────────────────────────────────────────────────────────────

export async function generateDashManifest(
  opts: { assetId: string },
  db: Database,
  storage: StorageClient,
  ffmpegPath: string,
): Promise<void> {
  const { assetId } = opts;

  const [variants, vidMeta] = await Promise.all([
    db
      .select({
        variantType: mediaVariants.variantType,
        storageKey: mediaVariants.storageKey,
      })
      .from(mediaVariants)
      .where(and(eq(mediaVariants.assetId, assetId), like(mediaVariants.variantType, 'video_%')))
      .orderBy(mediaVariants.height),
    db.query.videoMetadata.findFirst({
      where: eq(videoMetadata.assetId, assetId),
      columns: { audioCodec: true },
    }),
  ]);

  if (variants.length === 0) return;

  const dashWorkDir = join(tmpdir(), `mce-dash-${assetId}`);
  await mkdir(dashWorkDir, { recursive: true });
  const inputPaths: string[] = [];

  try {
    // Download all variant MP4s outside dashWorkDir
    for (const v of variants) {
      const buf = await storage.download(storage.bucketVariants, v.storageKey);
      const inputPath = join(tmpdir(), `mce-dash-input-${assetId}-${v.variantType}.mp4`);
      await writeFile(inputPath, buf);
      inputPaths.push(inputPath);
    }

    const hasAudio = vidMeta?.audioCodec != null;

    // Build ffmpeg args dynamically for N video renditions
    const args: string[] = [];
    for (const p of inputPaths) args.push('-i', p);

    // Map video stream from each input; audio only from the last (highest quality)
    for (let i = 0; i < inputPaths.length; i++) args.push('-map', `${i}:v:0`);
    if (hasAudio) args.push('-map', `${inputPaths.length - 1}:a:0?`);

    const adaptationSets = hasAudio ? 'id=0,streams=v id=1,streams=a' : 'id=0,streams=v';

    args.push(
      '-c', 'copy',
      '-f', 'dash',
      '-seg_duration', String(DASH_SEGMENT_DURATION),
      '-use_timeline', '1',
      '-use_template', '1',
      '-adaptation_sets', adaptationSets,
      '-init_seg_name', 'init_$RepresentationID$.m4s',
      '-media_seg_name', 'chunk_$RepresentationID$_$Number%05d$.m4s',
      '-y',
      'index.mpd',
    );

    await execFileAsync(ffmpegPath, args, {
      cwd: dashWorkDir,
      maxBuffer: 256 * 1024,
      timeout: 3600_000,
    });

    // Upload all generated DASH files
    const allFiles = await readdir(dashWorkDir);
    await Promise.all(
      allFiles.map(async (filename) => {
        const filePath = join(dashWorkDir, filename);
        const storageKey = `manifests/${assetId}/dash/${filename}`;
        const isManifest = filename.endsWith('.mpd');
        await storage.upload(storage.bucketVariants, storageKey, createReadStream(filePath), {
          contentType: isManifest ? 'application/dash+xml' : 'video/iso.segment',
          cacheControl: isManifest
            ? 'public, max-age=30'
            : 'public, max-age=31536000, immutable',
        });
      }),
    );

    const masterKey = manifestKey({ assetId, manifestType: 'dash' });
    await db.insert(streamingManifests).values({
      assetId,
      manifestType: 'dash',
      storageKey: masterKey,
      cdnUrl: storage.cdnUrl(masterKey),
    });
  } finally {
    await Promise.allSettled([
      rm(dashWorkDir, { recursive: true, force: true }),
      ...inputPaths.map(p => unlink(p)),
    ]);
  }
}
