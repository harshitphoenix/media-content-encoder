import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = fp(async (app) => {
  const client = new Redis(app.config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  await client.connect();

  app.decorate('redis', client);

  app.addHook('onClose', async () => {
    await client.quit();
    app.log.info('Redis connection closed');
  });

  app.log.info('Redis connected');
});

export default redisPlugin;
