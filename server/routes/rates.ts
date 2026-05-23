import type { FastifyInstance, FastifyRequest } from 'fastify';
import { currencyService } from '../services/currencyService.js';

type RatesQuery = { force?: string };

function parseForce(req: FastifyRequest): boolean {
  const raw = (req.query as RatesQuery | undefined)?.force;
  if (!raw) return false;
  const v = String(raw).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export async function ratesRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/rates           → usa cache (TTL configurável)
  // GET /api/rates?force=true → ignora cache e busca fresco da Investing
  fastify.get('/api/rates', async (req, reply) => {
    const force = parseForce(req);
    if (force) {
      // Garante que nenhum proxy/CDN entre o front e o backend reuse a resposta.
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
    return currencyService.getRates(force);
  });

  // POST /api/rates/refresh — força refresh (compat; rota canônica é GET ?force=true)
  fastify.post('/api/rates/refresh', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    return currencyService.getRates(true);
  });
}
