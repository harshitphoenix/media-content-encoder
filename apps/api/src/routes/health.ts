import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptime: { type: 'number' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.send({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    },
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Health'],
        summary: 'Readiness check — verifies DB and storage connectivity',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              checks: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              checks: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const checks: Record<string, string> = {};
      let allOk = true;

      // Database check
      try {
        await app.db.execute('select 1' as unknown as Parameters<typeof app.db.execute>[0]);
        checks['database'] = 'ok';
      } catch (err) {
        checks['database'] = 'error';
        allOk = false;
        app.log.error({ err }, 'Database readiness check failed');
      }

      // Storage check — attempt to stat a known key (non-fatal if bucket empty)
      try {
        await app.storage.stat(app.storage.bucketOriginals, '.health-check-probe');
        checks['storage'] = 'ok';
      } catch (err: unknown) {
        // A 404 means the bucket is reachable but the key doesn't exist — that's fine
        const code = (err as { Code?: string; name?: string }).Code ?? (err as { name?: string }).name;
        if (code === 'NoSuchKey' || code === 'NotFound') {
          checks['storage'] = 'ok';
        } else {
          checks['storage'] = 'error';
          allOk = false;
          app.log.error({ err }, 'Storage readiness check failed');
        }
      }

      // Redis check
      try {
        const pong = await app.redis.ping();
        checks['redis'] = pong === 'PONG' ? 'ok' : 'error';
        if (pong !== 'PONG') allOk = false;
      } catch (err) {
        checks['redis'] = 'error';
        allOk = false;
        app.log.error({ err }, 'Redis readiness check failed');
      }

      const status = allOk ? 200 : 503;
      return reply.code(status).send({ status: allOk ? 'ok' : 'degraded', checks });
    },
  );
};

export default healthRoutes;
