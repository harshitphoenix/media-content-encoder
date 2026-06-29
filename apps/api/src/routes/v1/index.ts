import type { FastifyPluginAsync } from 'fastify';
import uploadRoute from './media/upload.js';
import getRoute from './media/get.js';
import statusRoute from './media/status.js';
import variantsRoute from './media/variants.js';
import metricsRoute from './metrics.js';

const v1Routes: FastifyPluginAsync = async (app) => {
  await app.register(uploadRoute, { prefix: '/media' });
  await app.register(getRoute, { prefix: '/media' });
  await app.register(statusRoute, { prefix: '/media' });
  await app.register(variantsRoute, { prefix: '/media' });
  await app.register(metricsRoute);
};

export default v1Routes;
