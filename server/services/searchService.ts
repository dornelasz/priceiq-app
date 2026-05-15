/**
 * searchService — orquestra uma busca SaaS de ponta a ponta.
 *
 * Fluxo:
 *  1. POST /api/searches → create({query, supplierIds, forceRefresh})
 *     • Cria registro com status='running'
 *     • Dispara o worker em background (não bloqueia o request)
 *     • Retorna {searchId, status} imediatamente
 *
 *  2. Worker para cada fornecedor:
 *     • Se forceRefresh=false E cache válido → reaproveita (from_cache=true)
 *     • Senão: scrapeWithFallback (específico → Jina → Playwright)
 *     • Salva resultado em search_results (com erro se falhou)
 *
 *  3. Ao final, status vira:
 *     • completed     — todos os fornecedores deram OK
 *     • partial_failed— alguns OK, outros falharam
 *     • failed        — todos falharam
 *
 *  4. GET /api/searches/:id/results → search + progress + results + errors + best
 */
import { query, withTransaction } from '../db/client.js';
import { NotFoundError } from '../lib/errors.js';
import { supplierService, type Supplier } from './supplierService.js';
import { currencyService } from './currencyService.js';

export type SearchStatus = 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed';

export interface Search {
  id: string;
  query: string;
  status: SearchStatus;
  selected_supplier_ids: string[];
  best_supplier: string | null;
  best_total_brl: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface SearchResult {
  id: string;
  search_id: string;
  supplier_id: string;
  supplier_name: string;
  product_name: string | null;
  seller_name: string | null;
  price: number | null;
  freight: number | null;
  total_price: number | null;
  currency: string | null;
  exchange_rate_used: number | null;
  total_brl: number | null;
  product_url: string | null;
  match_score: number | null;
  confidence: number | null;
  available: boolean | null;
  warning: string | null;
  error_message: string | null;
  from_cache: boolean;
  collected_at: string;
  // Etapa 5.1 — validação anti produto-fantasma
  link_type: 'product' | 'search' | 'unverified' | null;
  link_validated: boolean;
  evidence_text: string | null;
  source_url: string | null;
  source_name: string | null;
  validation_warning: string | null;
}

interface SearchRow {
  id: string;
  query: string;
  status: SearchStatus;
  selected_supplier_ids: string[];
  best_supplier: string | null;
  best_total_brl: string | null;
  created_at: Date;
  completed_at: Date | null;
}

interface SearchResultRow {
  id: string;
  search_id: string;
  supplier_id: string;
  supplier_name: string | null;
  product_name: string | null;
  seller_name: string | null;
  price: string | null;
  freight: string | null;
  total_price: string | null;
  currency: string | null;
  exchange_rate_used: string | null;
  total_brl: string | null;
  product_url: string | null;
  match_score: number | null;
  confidence: number | null;
  available: boolean | null;
  warning: string | null;
  error_message: string | null;
  from_cache: boolean;
  collected_at: Date;
  link_type: 'product' | 'search' | 'unverified' | null;
  link_validated: boolean;
  evidence_text: string | null;
  source_url: string | null;
  source_name: string | null;
  validation_warning: string | null;
}

function parseNum(v: string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function searchToApi(row: SearchRow): Search {
  return {
    id: row.id,
    query: row.query,
    status: row.status,
    selected_supplier_ids: row.selected_supplier_ids ?? [],
    best_supplier: row.best_supplier,
    best_total_brl: parseNum(row.best_total_brl),
    created_at: row.created_at.toISOString(),
    completed_at: row.completed_at?.toISOString() ?? null,
  };
}

function resultToApi(row: SearchResultRow): SearchResult {
  return {
    id: row.id,
    search_id: row.search_id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name ?? '',
    product_name: row.product_name,
    seller_name: row.seller_name,
    price: parseNum(row.price),
    freight: parseNum(row.freight),
    total_price: parseNum(row.total_price),
    currency: row.currency,
    exchange_rate_used: parseNum(row.exchange_rate_used),
    total_brl: parseNum(row.total_brl),
    product_url: row.product_url,
    match_score: row.match_score,
    confidence: row.confidence,
    available: row.available,
    warning: row.warning,
    error_message: row.error_message,
    from_cache: row.from_cache,
    collected_at: row.collected_at.toISOString(),
    link_type: row.link_type,
    link_validated: row.link_validated,
    evidence_text: row.evidence_text,
    source_url: row.source_url,
    source_name: row.source_name,
    validation_warning: row.validation_warning,
  };
}

export interface InsertResultPayload {
  found: boolean;
  productName?: string;
  sellerName?: string;
  price?: number;
  freight?: number;
  currency?: string;
  exchangeRateUsed?: number;
  totalPrice?: number;
  totalBrl?: number;
  productUrl?: string;
  matchScore?: number;
  confidence?: number;
  available?: boolean;
  warning?: string;
  errorMessage?: string;
  fromCache?: boolean;
  // Etapa 5.1
  linkType?: 'product' | 'search' | 'unverified';
  linkValidated?: boolean;
  evidenceText?: string;
  sourceUrl?: string;
  sourceName?: string;
  validationWarning?: string;
}

export interface CreateSearchInput {
  query: string;
  supplierIds?: string[];
  forceRefresh?: boolean;
}

export const searchService = {
  async create(input: CreateSearchInput): Promise<Search> {
    return withTransaction(async (client) => {
      // Determina fornecedores-alvo
      let suppliers: Supplier[];
      if (input.supplierIds && input.supplierIds.length > 0) {
        suppliers = (await supplierService.getManyByIds(input.supplierIds)).filter(
          (s) => s.active,
        );
      } else {
        suppliers = await supplierService.listActive();
      }
      const selectedIds = suppliers.map((s) => s.id);

      // Cria com status='running' direto (worker é disparado no mesmo tick)
      const ins = await client.query<SearchRow>(
        `INSERT INTO searches (query, status, selected_supplier_ids)
         VALUES ($1, 'running', $2::uuid[])
         RETURNING *`,
        [input.query, selectedIds],
      );
      if (!ins.rows[0]) throw new Error('Falha ao criar search');
      const search = searchToApi(ins.rows[0]);

      // Dispara worker em background (não bloqueia o client)
      void import('../workers/priceSearchWorker.js').then(({ runSearchWorker }) => {
        runSearchWorker({
          searchId: search.id,
          query: input.query,
          suppliers,
          forceRefresh: input.forceRefresh === true,
        }).catch((e) => {
          console.error('[worker] erro fatal', e);
        });
      });

      return search;
    });
  },

  async get(id: string): Promise<Search> {
    const r = await query<SearchRow>(`SELECT * FROM searches WHERE id = $1`, [id]);
    if (!r.rows[0]) throw new NotFoundError('Busca');
    return searchToApi(r.rows[0]);
  },

  async list(opts: { limit: number; offset: number }): Promise<Search[]> {
    const r = await query<SearchRow>(
      `SELECT * FROM searches
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [opts.limit, opts.offset],
    );
    return r.rows.map(searchToApi);
  },

  async getResults(searchId: string): Promise<SearchResult[]> {
    await this.get(searchId); // valida existência
    const r = await query<SearchResultRow>(
      `SELECT sr.*, s.name AS supplier_name
       FROM search_results sr
       JOIN suppliers s ON s.id = sr.supplier_id
       WHERE sr.search_id = $1
       ORDER BY (sr.error_message IS NULL) DESC,
                sr.total_brl ASC NULLS LAST,
                sr.confidence DESC NULLS LAST`,
      [searchId],
    );
    return r.rows.map(resultToApi);
  },

  // ─── Helpers usados pelo worker ─────────────────────────

  async markRunning(searchId: string): Promise<void> {
    await query(`UPDATE searches SET status = 'running' WHERE id = $1`, [searchId]);
  },

  async finalizeStatus(searchId: string): Promise<{ status: SearchStatus; best: { supplier: string | null; totalBrl: number | null } }> {
    // Conta sucessos vs falhas
    const counts = await query<{ found: number; failed: number }>(
      `SELECT
         SUM(CASE WHEN error_message IS NULL AND total_brl IS NOT NULL THEN 1 ELSE 0 END)::int AS found,
         SUM(CASE WHEN error_message IS NOT NULL OR total_brl IS NULL THEN 1 ELSE 0 END)::int AS failed
       FROM search_results WHERE search_id = $1`,
      [searchId],
    );
    const c = counts.rows[0] ?? { found: 0, failed: 0 };
    const status: SearchStatus =
      c.found > 0 && c.failed === 0 ? 'completed' :
      c.found > 0 && c.failed > 0  ? 'partial_failed' :
      'failed';

    // Calcula best
    const best = await query<{ supplier_name: string | null; total_brl: string | null }>(
      `SELECT s.name AS supplier_name, sr.total_brl
       FROM search_results sr
       JOIN suppliers s ON s.id = sr.supplier_id
       WHERE sr.search_id = $1 AND sr.error_message IS NULL AND sr.total_brl IS NOT NULL
       ORDER BY sr.total_brl ASC, sr.confidence DESC NULLS LAST
       LIMIT 1`,
      [searchId],
    );
    const bestRow = best.rows[0];
    const bestSupplier = bestRow?.supplier_name ?? null;
    const bestTotalBrl = bestRow ? parseNum(bestRow.total_brl ?? null) : null;

    await query(
      `UPDATE searches
       SET status = $2, completed_at = NOW(),
           best_supplier = $3, best_total_brl = $4
       WHERE id = $1`,
      [searchId, status, bestSupplier, bestTotalBrl],
    );

    return { status, best: { supplier: bestSupplier, totalBrl: bestTotalBrl } };
  },

  async insertResult(
    searchId: string,
    sup: Supplier,
    payload: InsertResultPayload,
  ): Promise<void> {
    await query(
      `INSERT INTO search_results
       (search_id, supplier_id, product_name, seller_name, price, freight,
        total_price, currency, exchange_rate_used, total_brl, product_url,
        match_score, confidence, available, warning, error_message, from_cache,
        link_type, link_validated, evidence_text, source_url, source_name, validation_warning)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22,$23)`,
      [
        searchId,
        sup.id,
        payload.productName ?? null,
        payload.sellerName ?? null,
        payload.price ?? null,
        payload.freight ?? null,
        payload.totalPrice ?? null,
        payload.currency ?? null,
        payload.exchangeRateUsed ?? null,
        payload.totalBrl ?? null,
        payload.productUrl ?? null,
        payload.matchScore ?? null,
        payload.confidence ?? null,
        payload.available ?? null,
        payload.warning ?? null,
        payload.errorMessage ?? null,
        payload.fromCache ?? false,
        payload.linkType ?? null,
        payload.linkValidated ?? false,
        payload.evidenceText ?? null,
        payload.sourceUrl ?? null,
        payload.sourceName ?? null,
        payload.validationWarning ?? null,
      ],
    );
  },

  async convertToBrl(amount: number, currency: string): Promise<{ brl: number; rate: number }> {
    if (currency === 'BRL') return { brl: amount, rate: 1 };
    const rates = await currencyService.getRates(false);
    const rate =
      currency === 'USD' ? rates.usd :
      currency === 'EUR' ? rates.eur :
      currency === 'CNY' ? rates.cny : null;
    if (!rate || rate <= 0) return { brl: amount, rate: 0 };
    return { brl: parseFloat((amount * rate).toFixed(4)), rate };
  },
};
