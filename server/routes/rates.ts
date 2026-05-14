import type { FastifyInstance } from 'fastify';
import { currencyService } from '../services/currencyService.js';

export async function ratesRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/rates — usa cache (TTL configurável)
  fastify.get('/api/rates', async () => {
    return currencyService.getRates(false);
  });

  // POST /api/rates/refresh — força refresh (ignora cache)
  fastify.post('/api/rates/refresh', async () => {
    return currencyService.getRates(true);
  });
}
