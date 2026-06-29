import type { FastifyPluginAsync } from 'fastify';
import uploadRoute from './media/upload.js';
import getRoute from './media/get.js';
import statusRoute from './media/status.js';
import variantsRoute from './media/variants.js';
import manifestsRoute from './media/manifests.js';
import thumbnailsRoute from './media/thumbnails-route.js';
import accessRoute from './media/access.js';
import metricsRoute from './metrics.js';
import adminRoutes from './admin/index.js';

const v1Routes: FastifyPluginAsync = async (app) => {
  await app.register(uploadRoute, { prefix: '/media' });
  await app.register(getRoute, { prefix: '/media' });
  await app.register(statusRoute, { prefix: '/media' });
  await app.register(variantsRoute, { prefix: '/media' });
  await app.register(manifestsRoute, { prefix: '/media' });
  await app.register(thumbnailsRoute, { prefix: '/media' });
  await app.register(accessRoute, { prefix: '/media' });
  await app.register(metricsRoute);
  await app.register(adminRoutes, { prefix: '/admin' });
};

export default v1Routes;
