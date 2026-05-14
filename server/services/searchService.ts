/**
 * Orquestra uma busca:
 *  1. Cria registro em searches
 *  2. Dispara worker em background (in-process por enquanto)
 *  3. Worker chama scrapers em paralelo, com timeout e tratamento por fornecedor
 *  4. Resultados de cada fornecedor são salvos em search_results
 *  5. Atualiza progresso e status da busca
 */
import { query, withTransaction } from '../db/pool.js';
import { NotFoundError } from '../lib/errors.js';
import { supplierService, type Supplier } from './supplierService.js';
import { currencyService } from './currencyService.js';

export type SearchStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Search {
  id: string;
  user_id: string | null;
  query: string;
  status: SearchStatus;
  total_suppliers: number;
  completed_suppliers: number;
  best_price_brl: number | null;
  best_supplier: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface SearchResult {
  id: string;
  search_id: string;
  supplier_id: string;
  supplier_name: string;
  found: boolean;
  product_name: string | null;
  price: number | null;
  currency: string | null;
  price_brl: number | null;
  link: string | null;
  link_type: string | null;
  seller_name: string | null;
  product_rating: number | null;
  product_reviews: number | null;
  freight: number | null;
  freight_note: string | null;
  free_ship: boolean | null;
  total_brl: number | null;
  confidence: number | null;
  source_text: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface SearchRow {
  id: string;
  user_id: string | null;
  query: string;
  status: SearchStatus;
  total_suppliers: number;
  completed_suppliers: number;
  best_price_brl: string | null;
  best_supplier: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

interface SearchResultRow {
  id: string;
  search_id: string;
  supplier_id: string;
  supplier_name: string;
  found: boolean;
  product_name: string | null;
  price: string | null;
  currency: string | null;
  price_brl: string | null;
  link: string | null;
  link_type: string | null;
  seller_name: string | null;
  product_rating: string | null;
  product_reviews: number | null;
  freight: string | null;
  freight_note: string | null;
  free_ship: boolean | null;
  total_brl: string | null;
  confidence: number | null;
  source_text: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: Date;
}

function parseNum(v: string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function searchToApi(row: SearchRow): Search {
  return {
    id: row.id,
    user_id: row.user_id,
    query: row.query,
    status: row.status,
    total_suppliers: row.total_suppliers,
    completed_suppliers: row.completed_suppliers,
    best_price_brl: parseNum(row.best_price_brl),
    best_supplier: row.best_supplier,
    created_at: row.created_at.toISOString(),
    started_at: row.started_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
  };
}

function resultToApi(row: SearchResultRow): SearchResult {
  return {
    id: row.id,
    search_id: row.search_id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    found: row.found,
    product_name: row.product_name,
    price: parseNum(row.price),
    currency: row.currency,
    price_brl: parseNum(row.price_brl),
    link: row.link,
    link_type: row.link_type,
    seller_name: row.seller_name,
    product_rating: parseNum(row.product_rating),
    product_reviews: row.product_reviews,
    freight: parseNum(row.freight),
    freight_note: row.freight_note,
    free_ship: row.free_ship,
    total_brl: parseNum(row.total_brl),
    confidence: row.confidence,
    source_text: row.source_text,
    error_message: row.error_message,
    duration_ms: row.duration_ms,
    created_at: row.created_at.toISOString(),
  };
}

export const searchService = {
  async create(input: { query: string; supplierIds?: string[]; userId?: string | null }): Promise<Search> {
    return withTransaction(async (client) => {
      // Determina alvo: ids passados OU todos os enabled (globais + do usuário)
      let suppliers: Supplier[];
      if (input.supplierIds && input.supplierIds.length > 0) {
        const r = await client.query<{
          id: string; user_id: string | null; name: string; site: string; url_template: string | null;
          type: string; country: string; currency: string; enabled: boolean; notes: string | null;
          created_at: Date; updated_at: Date;
        }>(
          `SELECT * FROM suppliers WHERE id = ANY($1::uuid[]) AND enabled = TRUE`,
          [input.supplierIds],
        );
        suppliers = r.rows.map((row) => ({
          ...row,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        }));
      } else {
        suppliers = (await supplierService.list(input.userId ?? null)).filter((s) => s.enabled);
      }

      const ins = await client.query<SearchRow>(
        `INSERT INTO searches (user_id, query, status, total_suppliers, started_at)
         VALUES ($1, $2, 'pending', $3, NULL)
         RETURNING *`,
        [input.userId ?? null, input.query, suppliers.length],
      );
      if (!ins.rows[0]) throw new Error('Falha ao criar search');
      const search = searchToApi(ins.rows[0]);

      // Dispara worker (não bloqueia)
      void import('../workers/priceSearchWorker.js').then(({ runSearchWorker }) => {
        runSearchWorker({ searchId: search.id, query: input.query, suppliers }).catch((e) => {
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

  async list(opts: { limit: number; offset: number; userId?: string | null }): Promise<Search[]> {
    const r = await query<SearchRow>(
      `SELECT * FROM searches
       WHERE user_id IS NULL OR user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [opts.userId ?? null, opts.limit, opts.offset],
    );
    return r.rows.map(searchToApi);
  },

  async getResults(searchId: string): Promise<SearchResult[]> {
    // valida que a busca existe
    await this.get(searchId);
    const r = await query<SearchResultRow>(
      `SELECT * FROM search_results
       WHERE search_id = $1
       ORDER BY found DESC, total_brl ASC NULLS LAST, confidence DESC NULLS LAST`,
      [searchId],
    );
    return r.rows.map(resultToApi);
  },

  // ─── Helpers usados pelo worker ───

  async markRunning(searchId: string): Promise<void> {
    await query(
      `UPDATE searches SET status = 'running', started_at = NOW() WHERE id = $1`,
      [searchId],
    );
  },

  async markCompleted(searchId: string): Promise<void> {
    // calcula melhor preço/fornecedor
    const r = await query<{ supplier_name: string; total_brl: string | null }>(
      `SELECT supplier_name, total_brl FROM search_results
       WHERE search_id = $1 AND found = TRUE
       ORDER BY total_brl ASC NULLS LAST, confidence DESC NULLS LAST
       LIMIT 1`,
      [searchId],
    );
    const best = r.rows[0];
    await query(
      `UPDATE searches
       SET status = 'completed', completed_at = NOW(),
           best_price_brl = $2, best_supplier = $3
       WHERE id = $1`,
      [searchId, best ? parseNum(best.total_brl ?? null) : null, best?.supplier_name ?? null],
    );
  },

  async incrementCompleted(searchId: string): Promise<void> {
    await query(
      `UPDATE searches SET completed_suppliers = completed_suppliers + 1 WHERE id = $1`,
      [searchId],
    );
  },

  async insertResult(searchId: string, sup: Supplier, payload: {
    found: boolean;
    productName?: string | undefined;
    price?: number | undefined;
    currency?: string | undefined;
    priceBrl?: number | undefined;
    link?: string | undefined;
    linkType?: string | undefined;
    sellerName?: string | undefined;
    productRating?: number | undefined;
    productReviews?: number | undefined;
    freight?: number | undefined;
    freightNote?: string | undefined;
    freeShip?: boolean | undefined;
    totalBrl?: number | undefined;
    confidence?: number | undefined;
    sourceText?: string | undefined;
    errorMessage?: string | undefined;
    rawData?: unknown;
    durationMs?: number | undefined;
  }): Promise<void> {
    await query(
      `INSERT INTO search_results
       (search_id, supplier_id, supplier_name, found, product_name, price, currency,
        price_brl, link, link_type, seller_name, product_rating, product_reviews,
        freight, freight_note, free_ship, total_brl, confidence, source_text,
        error_message, raw_data, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        searchId,
        sup.id,
        sup.name,
        payload.found,
        payload.productName ?? null,
        payload.price ?? null,
        payload.currency ?? null,
        payload.priceBrl ?? null,
        payload.link ?? null,
        payload.linkType ?? null,
        payload.sellerName ?? null,
        payload.productRating ?? null,
        payload.productReviews ?? null,
        payload.freight ?? null,
        payload.freightNote ?? null,
        payload.freeShip ?? null,
        payload.totalBrl ?? null,
        payload.confidence ?? null,
        payload.sourceText ?? null,
        payload.errorMessage ?? null,
        payload.rawData ? JSON.stringify(payload.rawData) : null,
        payload.durationMs ?? null,
      ],
    );
  },

  async convertToBrl(amount: number, currency: string): Promise<number> {
    if (currency === 'BRL') return amount;
    const rates = await currencyService.getRates(false);
    const rate =
      currency === 'USD' ? rates.usd :
      currency === 'EUR' ? rates.eur :
      currency === 'CNY' ? rates.cny : null;
    if (!rate || rate <= 0) return amount; // fallback: deixa o valor sem conversão
    return parseFloat((amount * rate).toFixed(4));
  },
};
