// Deterministic storage key conventions for all asset and variant objects.
// Keeping path generation here ensures workers and API always agree on locations.

export interface OriginalKeyParams {
  assetId: string;
  mimeType: string;
}

export interface VariantKeyParams {
  assetId: string;
  variantType: string;
  format: string;
}

export interface ManifestKeyParams {
  assetId: string;
  manifestType: 'hls' | 'dash';
}

export interface ThumbnailKeyParams {
  assetId: string;
  thumbnailType: string;
  index?: number;
}

const EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
};

export function mimeToExtension(mimeType: string): string {
  return EXTENSION_MAP[mimeType] ?? 'bin';
}

/** Storage key for the original uploaded file. */
export function originalKey({ assetId, mimeType }: OriginalKeyParams): string {
  const ext = mimeToExtension(mimeType);
  return `originals/${assetId}/original.${ext}`;
}

/** Storage key for a processed variant. */
export function variantKey({ assetId, variantType, format }: VariantKeyParams): string {
  return `variants/${assetId}/${variantType}.${format}`;
}

/** Storage key for an HLS/DASH manifest file. */
export function manifestKey({ assetId, manifestType }: ManifestKeyParams): string {
  const filename = manifestType === 'hls' ? 'index.m3u8' : 'index.mpd';
  return `manifests/${assetId}/${manifestType}/${filename}`;
}

/** Storage key for a thumbnail. */
export function thumbnailKey({ assetId, thumbnailType, index = 0 }: ThumbnailKeyParams): string {
  return `thumbnails/${assetId}/${thumbnailType}/${index.toString().padStart(4, '0')}.jpg`;
}
