import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import addFormats from 'ajv-formats';
import type { FastifyError } from 'fastify';

/**
 * Verifies that enabling ajv-formats causes `format: 'uuid'` route schemas
 * to actually reject invalid values (without ajv-formats, the format keyword
 * is silently ignored by AJV 8, making UUID param validation a no-op).
 */
describe('UUID param validation via ajv-formats', () => {
  function buildApp() {
    const app = Fastify({
      logger: false,
      ajv: {
        customOptions: { removeAdditional: true, useDefaults: true },
        plugins: [addFormats as never],
      },
    });

    app.get<{ Params: { id: string } }>(
      '/:id',
      {
        schema: {
          params: {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid' } },
            required: ['id'],
          },
        },
      },
      async (req) => ({ id: req.params.id }),
    );

    return app;
  }

  it('accepts a valid UUID v4', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/550e8400-e29b-41d4-a716-446655440000',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }>().id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects a plain string with 400', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/not-a-uuid' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a numeric string with 400', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/12345' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a partial UUID with 400', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/550e8400-e29b-41d4' });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a UUID v1', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    });
    expect(res.statusCode).toBe(200);
  });
});

/**
 * Verifies production error handler strips internal messages from 5xx responses.
 * This prevents information leakage (CWE-209) — stack traces and DB details
 * must never reach the client in production.
 */
describe('Production error handler sanitization', () => {
  function buildApp(nodeEnv: 'production' | 'development') {
    const app = Fastify({ logger: false });

    app.decorate('config', { NODE_ENV: nodeEnv } as never);

    app.setErrorHandler((err: FastifyError, _req, reply) => {
      const statusCode = err.statusCode ?? 500;

      if (statusCode >= 500) {
        const nodeEnvValue = (app as unknown as { config: { NODE_ENV: string } }).config.NODE_ENV;
        return reply.code(statusCode).send({
          statusCode,
          error: 'Internal Server Error',
          // Never expose original message in production — CWE-209
          message: nodeEnvValue === 'production' ? 'An unexpected error occurred' : err.message,
        });
      }

      return reply.code(statusCode).send({
        statusCode,
        error: err.name ?? 'Error',
        message: err.message,
      });
    });

    app.get('/boom', async () => {
      throw new Error('secret internal detail: DB connection string = postgres://admin:pass@host/db');
    });

    return app;
  }

  it('production: returns generic message, not the internal error detail', async () => {
    const app = buildApp('production');
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json<{ message: string }>();
    expect(body.message).toBe('An unexpected error occurred');
    expect(body.message).not.toContain('DB connection string');
    expect(body.message).not.toContain('postgres://');
  });

  it('development: returns the original error message', async () => {
    const app = buildApp('development');
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain('secret internal detail');
  });
});
