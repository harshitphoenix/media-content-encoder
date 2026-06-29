import { describe, it, expect } from 'vitest';
import {
  isSupportedMimeType,
  isImageMimeType,
  isVideoMimeType,
  validateFileSize,
  validateImageDimensions,
  validateVideoDuration,
  MIME_TYPE,
  ALL_SUPPORTED_MIMES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT,
  MAX_VIDEO_DURATION_SECONDS,
} from '../index.js';

describe('MIME type predicates', () => {
  it('recognises supported image MIME types', () => {
    expect(isImageMimeType(MIME_TYPE.JPEG)).toBe(true);
    expect(isImageMimeType(MIME_TYPE.PNG)).toBe(true);
    expect(isImageMimeType(MIME_TYPE.WEBP)).toBe(true);
    expect(isImageMimeType(MIME_TYPE.AVIF)).toBe(true);
  });

  it('recognises supported video MIME types', () => {
    expect(isVideoMimeType(MIME_TYPE.MP4)).toBe(true);
    expect(isVideoMimeType(MIME_TYPE.MOV)).toBe(true);
    expect(isVideoMimeType(MIME_TYPE.MKV)).toBe(true);
    expect(isVideoMimeType(MIME_TYPE.WEBM)).toBe(true);
  });

  it('returns false for unsupported types', () => {
    expect(isImageMimeType('application/pdf')).toBe(false);
    expect(isVideoMimeType('audio/mpeg')).toBe(false);
    expect(isSupportedMimeType('text/html')).toBe(false);
  });

  it('correctly cross-classifies: images are not videos', () => {
    expect(isVideoMimeType(MIME_TYPE.JPEG)).toBe(false);
    expect(isImageMimeType(MIME_TYPE.MP4)).toBe(false);
  });

  it('accepts all explicitly supported types via isSupportedMimeType', () => {
    for (const mime of ALL_SUPPORTED_MIMES) {
      expect(isSupportedMimeType(mime)).toBe(true);
    }
  });
});

describe('validateFileSize', () => {
  it('allows an image within the image limit', () => {
    expect(() => validateFileSize(MAX_IMAGE_SIZE_BYTES - 1, MIME_TYPE.JPEG)).not.toThrow();
  });

  it('allows a video within the video limit', () => {
    expect(() => validateFileSize(MAX_VIDEO_SIZE_BYTES - 1, MIME_TYPE.MP4)).not.toThrow();
  });

  it('rejects an image that exceeds the image limit', () => {
    expect(() => validateFileSize(MAX_IMAGE_SIZE_BYTES + 1, MIME_TYPE.PNG)).toThrow(
      /exceeds the .* limit for images/,
    );
  });

  it('rejects a video that exceeds the video limit', () => {
    expect(() => validateFileSize(MAX_VIDEO_SIZE_BYTES + 1, MIME_TYPE.MP4)).toThrow(
      /exceeds the .* limit for videos/,
    );
  });

  it('accepts image at the exact limit boundary', () => {
    expect(() => validateFileSize(MAX_IMAGE_SIZE_BYTES, MIME_TYPE.JPEG)).not.toThrow();
  });
});

describe('validateImageDimensions', () => {
  it('allows images within the max dimensions', () => {
    expect(() => validateImageDimensions(1920, 1080)).not.toThrow();
    expect(() => validateImageDimensions(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT)).not.toThrow();
  });

  it('rejects images that exceed max width', () => {
    expect(() => validateImageDimensions(MAX_IMAGE_WIDTH + 1, 100)).toThrow(/exceed/);
  });

  it('rejects images that exceed max height', () => {
    expect(() => validateImageDimensions(100, MAX_IMAGE_HEIGHT + 1)).toThrow(/exceed/);
  });

  it('allows 1×1 pixel images', () => {
    expect(() => validateImageDimensions(1, 1)).not.toThrow();
  });
});

describe('validateVideoDuration', () => {
  it('allows videos within the duration limit', () => {
    expect(() => validateVideoDuration(MAX_VIDEO_DURATION_SECONDS - 1)).not.toThrow();
    expect(() => validateVideoDuration(MAX_VIDEO_DURATION_SECONDS)).not.toThrow();
  });

  it('rejects videos that exceed the duration limit', () => {
    expect(() => validateVideoDuration(MAX_VIDEO_DURATION_SECONDS + 1)).toThrow(/exceeds/);
  });

  it('allows zero-duration (edge case)', () => {
    expect(() => validateVideoDuration(0)).not.toThrow();
  });
});
