import type { FastifyPluginAsync } from 'fastify';
import adminAuthPlugin from '../../../plugins/admin-auth.js';
import adminMetricsRoute from './metrics.js';
import reprocessRoute from './reprocess.js';
import deleteRoute from './delete.js';

const adminRoutes: FastifyPluginAsync = async (app) => {
  // All routes registered in this scope require admin auth
  await app.register(adminAuthPlugin);

  await app.register(adminMetricsRoute);
  await app.register(reprocessRoute, { prefix: '/media' });
  await app.register(deleteRoute, { prefix: '/media' });
};

export default adminRoutes;
