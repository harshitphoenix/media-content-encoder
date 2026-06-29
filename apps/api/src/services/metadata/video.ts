import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VideoMetadata } from '@mce/shared';

const execFileAsync = promisify(execFile);

export interface VideoProbeResult {
  width: number;
  height: number;
  durationSeconds: number;
  codec: string;
  fps: number;
  bitrateBps: number;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRateHz: number | null;
}

export class VideoProbeError extends Error {
  readonly originalCause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'VideoProbeError';
    this.originalCause = cause;
  }
}

// ffprobe JSON output shapes (only the fields we use)
interface FfprobeStream {
  codec_type: 'video' | 'audio' | 'data' | 'subtitle';
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
}

interface FfprobeFormat {
  duration?: string;
  bit_rate?: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

/**
 * Probes a video file with ffprobe and returns its metadata.
 * Throws VideoProbeError if ffprobe is unavailable or the file is corrupt.
 */
export async function probeVideo(filePath: string, ffprobePath = 'ffprobe'): Promise<VideoProbeResult> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], { maxBuffer: 4 * 1024 * 1024 }));
  } catch (cause) {
    const msg = cause instanceof Error && cause.message.includes('ENOENT')
      ? `ffprobe not found at "${ffprobePath}". Install FFmpeg: brew install ffmpeg`
      : 'ffprobe failed — video file may be corrupt or unreadable';
    throw new VideoProbeError(msg, cause);
  }

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch (cause) {
    throw new VideoProbeError('ffprobe returned unparseable output', cause);
  }

  const videoStream = parsed.streams.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams.find((s) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new VideoProbeError('No video stream found — file may not be a valid video');
  }
  if (!videoStream.width || !videoStream.height) {
    throw new VideoProbeError('Video stream has no dimensions');
  }

  const rawDuration = videoStream.duration ?? parsed.format.duration;
  if (!rawDuration) {
    throw new VideoProbeError('Cannot determine video duration');
  }

  const fps = parseFps(videoStream.r_frame_rate ?? '');
  const bitrateBps = parseInt(parsed.format.bit_rate ?? '0', 10);

  return {
    width: videoStream.width,
    height: videoStream.height,
    durationSeconds: parseFloat(rawDuration),
    codec: videoStream.codec_name,
    fps,
    bitrateBps: isNaN(bitrateBps) ? 0 : bitrateBps,
    audioCodec: audioStream?.codec_name ?? null,
    audioChannels: audioStream?.channels ?? null,
    audioSampleRateHz: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
  };
}

/** Parse ffprobe r_frame_rate "30000/1001" → 29.97 */
function parseFps(raw: string): number {
  const parts = raw.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!num || !den || den === 0) return 0;
  return Math.round((num / den) * 100) / 100;
}

/** Map VideoProbeResult to the shared VideoMetadata shape (minus assetId/createdAt). */
export function toVideoMetadataValues(
  probe: VideoProbeResult,
): Omit<VideoMetadata, 'assetId' | 'createdAt'> {
  return {
    width: probe.width,
    height: probe.height,
    durationSeconds: probe.durationSeconds,
    codec: probe.codec,
    fps: probe.fps,
    bitrateBps: probe.bitrateBps,
    audioCodec: probe.audioCodec,
    audioChannels: probe.audioChannels,
    audioSampleRateHz: probe.audioSampleRateHz,
  };
}
