import type { FastifyInstance } from 'fastify';
import { searchService } from '../services/searchService.js';
import { idParamSchema } from '../lib/validators.js';

export async function resultsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/searches/:id/results
  fastify.get('/api/searches/:id/results', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const items = await searchService.getResults(id);
    return { search_id: id, items };
  });
}
