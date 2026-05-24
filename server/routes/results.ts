import type { FastifyInstance } from 'fastify';
import { searchService } from '../services/searchService.js';
import { rankingService } from '../services/rankingService.js';
import { isSuccessStatus, isPartialStatus } from '../lib/resultStatus.js';
import { idParamSchema } from '../lib/validators.js';

export async function resultsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/searches/:id/results
   *
   * Resposta:
   * {
   *   search: { id, query, status, created_at, completed_at, ... },
   *   progress: { total, completed, failed, running },
   *   results: [ { ... } ],   // completos (total final), ordenados por melhor valor
   *   partials: [ { ... } ],  // preço validado, frete a confirmar (sem total)
   *   errors: [ { supplier_name, status, error_message } ],
   *   best: { supplier_name, total_brl, product_url, ... } | null
   * }
   */
  fastify.get('/api/searches/:id/results', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [search, all] = await Promise.all([
      searchService.get(id),
      searchService.getResults(id),
    ]);

    // Completo: total final confirmado (concorre a "melhor preço").
    const valid = all.filter((r) => isSuccessStatus(r.status) && r.total_brl !== null);
    // Parcial: preço validado, frete a confirmar (útil, mas sem total).
    const partials = all.filter((r) => isPartialStatus(r.status));
    // Falha real: nem completo, nem parcial.
    const failed = all.filter((r) => !isSuccessStatus(r.status) && !isPartialStatus(r.status));
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
        partial: partials.length,
        running,
      },
      results: ordered,
      partials,
      errors: failed.map((r) => ({
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        status: r.status,
        error_message: r.error_message,
      })),
      best,
    };
  });
}
