import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}

interface RootPluginOptions {
  config: Config;
}

const rootPlugin: FastifyPluginAsync<RootPluginOptions> = fp(
  async (app: FastifyInstance, opts: RootPluginOptions) => {
    // Expose config on all plugin instances
    app.decorate('config', opts.config);

    // Error normalization + helpers (httpErrors, assert, etc.)
    await app.register(sensible);

    // CORS — tightened in production
    await app.register(cors, {
      origin: opts.config.NODE_ENV === 'production' ? false : true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  },
);

export default rootPlugin;
