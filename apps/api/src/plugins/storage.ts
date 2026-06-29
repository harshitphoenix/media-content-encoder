import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { StorageClient } from '@mce/storage';

declare module 'fastify' {
  interface FastifyInstance {
    storage: StorageClient;
  }
}

const storagePlugin: FastifyPluginAsync = fp(async (app) => {
  const cfg = app.config;

  const storage = new StorageClient({
    endpoint: cfg.STORAGE_ENDPOINT,
    region: cfg.STORAGE_REGION,
    accessKeyId: cfg.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: cfg.STORAGE_SECRET_ACCESS_KEY,
    bucketOriginals: cfg.STORAGE_BUCKET_ORIGINALS,
    bucketVariants: cfg.STORAGE_BUCKET_VARIANTS,
    cdnBaseUrl: cfg.CDN_BASE_URL,
    cdnUrlTtlSeconds: cfg.CDN_URL_TTL_SECONDS,
    forcePathStyle: cfg.STORAGE_FORCE_PATH_STYLE,
  });

  app.decorate('storage', storage);

  app.log.info('Storage client initialized');
});

export default storagePlugin;
