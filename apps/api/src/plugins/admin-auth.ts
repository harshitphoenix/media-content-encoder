import { timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Admin auth plugin — validates `Authorization: Bearer <ADMIN_API_KEY>` on every
 * request reaching the scope it is registered in.
 *
 * Uses a timing-safe comparison (CWE-208) to prevent oracle attacks even when
 * the provided key has a different length than the real key.
 */
const adminAuthPlugin: FastifyPluginAsync = fp(async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Authorization header required' });
    }

    const provided = auth.slice(7);
    const expected = app.config.ADMIN_API_KEY;

    if (!safeCompare(provided, expected)) {
      req.log.warn({ ip: req.ip, path: req.url }, 'Admin auth failed — invalid key');
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });
});

/**
 * Timing-safe string comparison that avoids leaking key length.
 * When lengths differ we still perform a dummy comparison so the
 * execution time does not reveal which branch was taken.
 */
function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf); // dummy — keep timing uniform
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export default adminAuthPlugin;
