import type { FastifyInstance } from 'fastify';
import { searchService } from '../services/searchService.js';
import { rankingService } from '../services/rankingService.js';
import { idParamSchema } from '../lib/validators.js';

export async function resultsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/searches/:id/results
   *
   * Resposta:
   * {
   *   search: { id, query, status, created_at, completed_at, ... },
   *   progress: { total, completed, failed, running },
   *   results: [ { ... } ],   // só os encontrados, ordenados por melhor valor
   *   errors: [ { supplier_name, error_message } ],
   *   best: { supplier_name, total_brl, product_url, ... } | null
   * }
   */
  fastify.get('/api/searches/:id/results', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [search, all] = await Promise.all([
      searchService.get(id),
      searchService.getResults(id),
    ]);

    const valid = all.filter((r) => !r.error_message && r.total_brl !== null);
    const failed = all.filter((r) => r.error_message);
    const ordered = rankingService.sortByBestValue(valid);
    const best = ordered[0] ?? null;

    const total = search.selected_supplier_ids.length;
    const completed = all.length;          // já processados (gravados)
    const failedCount = failed.length;
    const running = Math.max(0, total - completed);

    return {
      search,
      progress: {
        total,
        completed,
        failed: failedCount,
        running,
      },
      results: ordered,
      errors: failed.map((r) => ({
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        error_message: r.error_message,
      })),
      best,
    };
  });
}
