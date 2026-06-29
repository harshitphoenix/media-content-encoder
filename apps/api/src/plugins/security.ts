import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import type { FastifyError, FastifyPluginAsync } from 'fastify';

const securityPlugin: FastifyPluginAsync = fp(async (app) => {
  // Security headers — appropriate for a JSON API (no CSP needed for non-HTML responses)
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow CDN/S3 resources
  });

  // Production-safe error handler — strips stack traces and internal messages on 5xx
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const statusCode = err.statusCode ?? 500;

    if (statusCode >= 500) {
      req.log.error({ err, reqId: req.id, method: req.method, url: req.url }, 'Unhandled error');
      return reply.code(statusCode).send({
        statusCode,
        error: 'Internal Server Error',
        // Never expose original message in production — CWE-209
        message:
          app.config.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
      });
    }

    // 4xx: safe to forward — no internal state leaked
    return reply.code(statusCode).send({
      statusCode,
      error: err.name ?? 'Error',
      message: err.message,
    });
  });
});

export default securityPlugin;
