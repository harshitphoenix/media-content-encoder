import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createDb, type Database } from '@mce/db';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

const dbPlugin: FastifyPluginAsync = fp(async (app) => {
  const url = app.config.DATABASE_URL;
  const db = createDb(url);

  app.decorate('db', db);

  app.log.info('Database client initialized');
});

export default dbPlugin;
