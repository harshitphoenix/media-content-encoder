import fp from 'fastify-plugin';
import rateLimitPlugin from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

const rateLimiter: FastifyPluginAsync = fp(async (app) => {
  await app.register(rateLimitPlugin, {
    global: true,
    max: app.config.RATE_LIMIT_MAX,
    timeWindow: app.config.RATE_LIMIT_WINDOW_MS,
    redis: app.redis,
    nameSpace: 'rl:',
    keyGenerator: (req) => req.ip ?? 'unknown',
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${Math.ceil((context.ttl as number) / 1000)} seconds.`,
      retryAfter: Math.ceil((context.ttl as number) / 1000),
    }),
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });
});

export default rateLimiter;
