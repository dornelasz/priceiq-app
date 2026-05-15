import type { FastifyInstance } from 'fastify';
import { searchService } from '../services/searchService.js';
import {
  idParamSchema,
  searchCreateSchema,
  searchListQuerySchema,
} from '../lib/validators.js';

export async function searchesRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/searches — cria busca e dispara worker em background.
  // Resposta enxuta: { searchId, status }.
  fastify.post('/api/searches', async (req, reply) => {
    const body = searchCreateSchema.parse(req.body);
    const created = await searchService.create({
      query: body.query,
      supplierIds: body.supplier_ids ?? body.supplierIds,
      forceRefresh: body.forceRefresh === true,
    });
    reply.code(202).send({
      searchId: created.id,
      status: created.status,
    });
    return reply;
  });

  // GET /api/searches — lista paginada (mantida).
  fastify.get('/api/searches', async (req) => {
    const q = searchListQuerySchema.parse(req.query);
    const items = await searchService.list({ limit: q.limit, offset: q.offset });
    return { items, limit: q.limit, offset: q.offset };
  });

  // GET /api/searches/:id — status + progresso resumido da busca.
  fastify.get('/api/searches/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    return searchService.get(id);
  });
}
