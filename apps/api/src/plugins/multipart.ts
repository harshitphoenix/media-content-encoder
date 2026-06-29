import fp from 'fastify-plugin';
import multipart from '@fastify/multipart';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export interface TempUpload {
  /** Absolute path to the temp file on disk */
  filePath: string;
  /** Original client-provided filename (sanitised) */
  filename: string;
  /** Client-declared MIME type — treat as a hint only; verify with magic bytes */
  declaredMimeType: string;
  /** Removes the temp file from disk */
  cleanup(): Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Saves the first multipart file part to a temp file and returns metadata.
     * The caller MUST call `upload.cleanup()` in a finally block.
     */
    saveUpload(): Promise<TempUpload>;
  }
}

const multipartPlugin: FastifyPluginAsync = fp(async (app) => {
  const maxFileSize = app.config.MAX_VIDEO_SIZE_BYTES;

  await app.register(multipart, {
    limits: {
      fileSize: maxFileSize,
      files: 1,
      fields: 0,
      headerPairs: 100,
    },
  });

  app.decorateRequest('saveUpload', async function saveUpload(this: FastifyRequest): Promise<TempUpload> {
    let part: MultipartFile | undefined;
    try {
      part = await this.file();
    } catch {
      throw new Error('Failed to parse multipart request. Ensure Content-Type is multipart/form-data.');
    }

    if (!part) {
      throw new Error('No file found in the request. Send a multipart/form-data request with a file field.');
    }

    const rawExt = part.filename.split('.').pop() ?? '';
    const ext = rawExt.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10);
    const tmpName = `mce-${randomUUID()}${ext ? `.${ext}` : ''}`;
    const filePath = join(tmpdir(), tmpName);

    await pipeline(part.file, createWriteStream(filePath));

    return {
      filePath,
      filename: sanitiseFilename(part.filename),
      declaredMimeType: part.mimetype,
      cleanup: () => unlink(filePath).catch(() => undefined),
    };
  });
});

/** Strip directory traversal and null bytes; keep only last path segment. */
function sanitiseFilename(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? 'upload';
  return last.replace(/\0/g, '').trim().slice(0, 255) || 'upload';
}

export default multipartPlugin;
