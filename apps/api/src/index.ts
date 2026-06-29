import Fastify from 'fastify';
import { loadConfig } from './config.js';
import rootPlugin from './plugins/root.js';
import dbPlugin from './plugins/db.js';
import storagePlugin from './plugins/storage.js';
import healthRoutes from './routes/health.js';

async function bootstrap() {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    ajv: {
      customOptions: {
        removeAdditional: true,
        coerceTypes: 'array',
        useDefaults: true,
      },
    },
  });

  // ── Plugins ───────────────────────────────────────────────────────────────
  await app.register(rootPlugin, { config });
  await app.register(dbPlugin);
  await app.register(storagePlugin);

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(healthRoutes);

  // ── Start ─────────────────────────────────────────────────────────────────
  const address = await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info(`Server listening at ${address}`);

  return app;
}

// Graceful shutdown
function setupShutdown(app: Awaited<ReturnType<typeof bootstrap>>) {
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, closing server');
    await app.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

const app = await bootstrap();
setupShutdown(app);
