import sharp, { type Metadata } from 'sharp';
import type { ImageMetadata } from '@mce/shared';

export interface ImageProbeResult {
  width: number;
  height: number;
  format: string;
  colorSpace: string | null;
  hasAlpha: boolean;
}

export class ImageProbeError extends Error {
  readonly originalCause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ImageProbeError';
    this.originalCause = cause;
  }
}

/**
 * Probes an image file and returns its metadata.
 * Throws ImageProbeError if the file cannot be read as a valid image.
 */
export async function probeImage(filePath: string): Promise<ImageProbeResult> {
  let meta: Metadata;
  try {
    meta = await sharp(filePath).metadata();
  } catch (cause) {
    throw new ImageProbeError('Cannot read image — file may be corrupt or unsupported', cause);
  }

  if (!meta.width || !meta.height) {
    throw new ImageProbeError('Image probe returned no dimensions — file may be corrupt');
  }

  return {
    width: meta.width,
    height: meta.height,
    format: meta.format ?? 'unknown',
    colorSpace: meta.space ?? null,
    hasAlpha: meta.hasAlpha ?? false,
  };
}

/** Map ImageProbeResult to the shared ImageMetadata shape (minus assetId/createdAt). */
export function toImageMetadataValues(
  probe: ImageProbeResult,
): Omit<ImageMetadata, 'assetId' | 'createdAt'> {
  return {
    width: probe.width,
    height: probe.height,
    format: probe.format,
    colorSpace: probe.colorSpace,
    hasAlpha: probe.hasAlpha,
  };
}
