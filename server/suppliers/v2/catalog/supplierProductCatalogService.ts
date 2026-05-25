/**
 * supplierProductCatalogService — serviço de persistência do catálogo de
 * produtos por fornecedor (Etapa 14).
 *
 * Funções puras (sem I/O): normalizeCatalogQuery, hashProductUrl.
 * Funções DB: criadas via createSupplierProductCatalogService(queryFn) para
 * permitir injeção nos testes sem tocar em banco real.
 *
 * Regras:
 *  - Nunca salvar candidato sem supplierId e productUrl.
 *  - Deduplicar por (supplier_id, url_hash) — ON CONFLICT DO UPDATE.
 *  - Não apagar histórico ao atualizar (first_seen_at permanece imutável).
 *  - Nunca salvar HTML bruto em evidence_text.
 *  - Truncar evidence_text em MAX_EVIDENCE_LENGTH caracteres.
 */

import { createHash } from 'node:crypto';
import type pg from 'pg';
import { query as defaultQuery } from '../../../db/client.js';
import { normalizeSearchQuery } from '../searchEngine/core/searchEngineContext.js';
import type {
  SupplierProductCandidate,
  SupplierProductMatch,
  SupplierDiscoveryRun,
  UpsertCandidateInput,
  UpdateCandidateExtractionInput,
  CreateDiscoveryRunInput,
  FinishDiscoveryRunInput,
  CreateOrUpdateMatchInput,
} from './catalogTypes.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

export const MAX_EVIDENCE_LENGTH = 2000;

// ─── Funções puras (sem I/O) ──────────────────────────────────────────────────

/**
 * Normaliza a query para uso no catálogo — mesma lógica do motor de busca.
 * Garante que buscas equivalentes (com/sem acento, maiúsc/minúsc) apontem
 * para os mesmos candidatos no banco.
 */
export function normalizeCatalogQuery(query: string): string {
  return normalizeSearchQuery(query);
}

/**
 * Hash estável (SHA-256, 64 hex chars) de uma URL para deduplicação.
 * Normaliza URL antes de hashear: trim + lowercase.
 */
export function hashProductUrl(url: string): string {
  return createHash('sha256')
    .update(url.trim().toLowerCase())
    .digest('hex')
    .slice(0, 64);
}

/**
 * Trunca evidence_text para evitar linhas gigantes no banco.
 * Nunca salva HTML bruto — a responsabilidade de limpar o texto
 * é do chamador; aqui só aplica o limite de tamanho.
 */
export function truncateEvidenceText(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text.length > MAX_EVIDENCE_LENGTH ? text.slice(0, MAX_EVIDENCE_LENGTH) : text;
}

// ─── Conversores DB row → API ──────────────────────────────────────────────────

type CandidateRow = {
  id: string;
  supplier_id: string;
  query_text: string;
  normalized_query: string;
  product_url: string;
  canonical_url: string | null;
  url_hash: string;
  source: string;
  status: string;
  product_name: string | null;
  brand: string | null;
  sku: string | null;
  price: string | null;
  currency: string | null;
  price_brl: string | null;
  freight: string | null;
  freight_status: string | null;
  total_brl: string | null;
  match_score: string | null;
  confidence: string | null;
  evidence_text: string | null;
  price_evidence_text: string | null;
  last_checked_at: string | null;
  first_seen_at: string;
  updated_at: string;
};

type MatchRow = {
  id: string;
  supplier_id: string;
  candidate_id: string;
  query_text: string;
  normalized_query: string;
  match_status: string;
  match_score: string | null;
  confidence: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  supplier_id: string;
  query_text: string;
  normalized_query: string;
  source: string;
  status: string;
  candidates_found: string;
  candidates_saved: string;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

function parseNum(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function candidateRowToApi(row: CandidateRow): SupplierProductCandidate {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    queryText: row.query_text,
    normalizedQuery: row.normalized_query,
    productUrl: row.product_url,
    canonicalUrl: row.canonical_url,
    urlHash: row.url_hash,
    source: row.source as SupplierProductCandidate['source'],
    status: row.status as SupplierProductCandidate['status'],
    productName: row.product_name,
    brand: row.brand,
    sku: row.sku,
    price: parseNum(row.price),
    currency: row.currency,
    priceBrl: parseNum(row.price_brl),
    freight: parseNum(row.freight),
    freightStatus: row.freight_status,
    totalBrl: parseNum(row.total_brl),
    matchScore: parseNum(row.match_score),
    confidence: parseNum(row.confidence),
    evidenceText: row.evidence_text,
    priceEvidenceText: row.price_evidence_text,
    lastCheckedAt: row.last_checked_at,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  };
}

function matchRowToApi(row: MatchRow): SupplierProductMatch {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    candidateId: row.candidate_id,
    queryText: row.query_text,
    normalizedQuery: row.normalized_query,
    matchStatus: row.match_status as SupplierProductMatch['matchStatus'],
    matchScore: parseNum(row.match_score),
    confidence: parseNum(row.confidence),
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runRowToApi(row: RunRow): SupplierDiscoveryRun {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    queryText: row.query_text,
    normalizedQuery: row.normalized_query,
    source: row.source as SupplierDiscoveryRun['source'],
    status: row.status as SupplierDiscoveryRun['status'],
    candidatesFound: parseInt(row.candidates_found, 10),
    candidatesSaved: parseInt(row.candidates_saved, 10),
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

// ─── Tipo da função de query (injetável nos testes) ───────────────────────────

type QueryFn = (
  text: string,
  params?: unknown[],
) => Promise<pg.QueryResult<pg.QueryResultRow>>;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSupplierProductCatalogService(queryFn: QueryFn = defaultQuery) {
  /**
   * Insere ou atualiza um candidato de URL.
   * Conflito em (supplier_id, url_hash) → atualiza status/score/updated_at
   * sem alterar first_seen_at.
   */
  async function upsertCandidate(
    input: UpsertCandidateInput,
  ): Promise<SupplierProductCandidate> {
    const {
      supplierId,
      queryText,
      normalizedQuery,
      productUrl,
      canonicalUrl = null,
      urlHash,
      source,
      status = 'candidate',
      matchScore = null,
    } = input;

    const sql = `
      INSERT INTO supplier_product_candidates
        (supplier_id, query_text, normalized_query, product_url, canonical_url,
         url_hash, source, status, match_score)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (supplier_id, url_hash) DO UPDATE SET
        status        = EXCLUDED.status,
        match_score   = COALESCE(EXCLUDED.match_score, supplier_product_candidates.match_score),
        canonical_url = COALESCE(EXCLUDED.canonical_url, supplier_product_candidates.canonical_url),
        updated_at    = NOW()
      RETURNING *
    `;
    const res = await queryFn(sql, [
      supplierId, queryText, normalizedQuery, productUrl, canonicalUrl,
      urlHash, source, status, matchScore,
    ]);
    return candidateRowToApi(res.rows[0] as CandidateRow);
  }

  /**
   * Lista candidatos de um fornecedor para uma query normalizada.
   * Retorna ordenado por match_score DESC.
   */
  async function listCandidatesByQuery(
    supplierId: string,
    normalizedQuery: string,
  ): Promise<SupplierProductCandidate[]> {
    const sql = `
      SELECT * FROM supplier_product_candidates
      WHERE supplier_id = $1 AND normalized_query = $2
      ORDER BY match_score DESC NULLS LAST, first_seen_at ASC
    `;
    const res = await queryFn(sql, [supplierId, normalizedQuery]);
    return (res.rows as CandidateRow[]).map(candidateRowToApi);
  }

  /**
   * Retorna matches confirmados para (supplierId, normalizedQuery).
   * Usado para reaproveitar resultados validados sem buscar do zero.
   */
  async function listReusableMatches(
    supplierId: string,
    normalizedQuery: string,
  ): Promise<SupplierProductMatch[]> {
    const sql = `
      SELECT * FROM supplier_product_matches
      WHERE supplier_id = $1
        AND normalized_query = $2
        AND match_status = 'confirmed'
      ORDER BY match_score DESC NULLS LAST
    `;
    const res = await queryFn(sql, [supplierId, normalizedQuery]);
    return (res.rows as MatchRow[]).map(matchRowToApi);
  }

  /**
   * Atualiza dados de extração de um candidato (preço, produto, evidência).
   * Seta last_checked_at = NOW(). Trunca evidence_text automaticamente.
   * Nunca sobrescreve first_seen_at.
   */
  async function updateCandidateExtraction(
    input: UpdateCandidateExtractionInput,
  ): Promise<SupplierProductCandidate> {
    const sql = `
      UPDATE supplier_product_candidates SET
        status              = $1,
        product_name        = $2,
        brand               = $3,
        sku                 = $4,
        price               = $5,
        currency            = $6,
        price_brl           = $7,
        freight             = $8,
        freight_status      = $9,
        total_brl           = $10,
        confidence          = $11,
        evidence_text       = $12,
        price_evidence_text = $13,
        match_score         = COALESCE($14, match_score),
        last_checked_at     = NOW(),
        updated_at          = NOW()
      WHERE id = $15
      RETURNING *
    `;
    const res = await queryFn(sql, [
      input.status,
      input.productName ?? null,
      input.brand ?? null,
      input.sku ?? null,
      input.price ?? null,
      input.currency ?? null,
      input.priceBrl ?? null,
      input.freight ?? null,
      input.freightStatus ?? null,
      input.totalBrl ?? null,
      input.confidence ?? null,
      truncateEvidenceText(input.evidenceText),
      truncateEvidenceText(input.priceEvidenceText),
      input.matchScore ?? null,
      input.candidateId,
    ]);
    return candidateRowToApi(res.rows[0] as CandidateRow);
  }

  /**
   * Cria um registro de execução de discovery. Retorna o run criado.
   */
  async function createDiscoveryRun(
    input: CreateDiscoveryRunInput,
  ): Promise<SupplierDiscoveryRun> {
    const sql = `
      INSERT INTO supplier_discovery_runs
        (supplier_id, query_text, normalized_query, source, status)
      VALUES ($1, $2, $3, $4, 'completed')
      RETURNING *
    `;
    const res = await queryFn(sql, [
      input.supplierId,
      input.queryText,
      input.normalizedQuery,
      input.source,
    ]);
    return runRowToApi(res.rows[0] as RunRow);
  }

  /**
   * Finaliza um discovery run — atualiza status, contadores e finished_at.
   */
  async function finishDiscoveryRun(
    input: FinishDiscoveryRunInput,
  ): Promise<SupplierDiscoveryRun> {
    const sql = `
      UPDATE supplier_discovery_runs SET
        status           = $1,
        candidates_found = $2,
        candidates_saved = $3,
        error_message    = $4,
        finished_at      = NOW()
      WHERE id = $5
      RETURNING *
    `;
    const res = await queryFn(sql, [
      input.status,
      input.candidatesFound,
      input.candidatesSaved,
      input.errorMessage ?? null,
      input.runId,
    ]);
    return runRowToApi(res.rows[0] as RunRow);
  }

  /**
   * Cria ou atualiza o match entre uma query e um candidato.
   * Conflito em (supplier_id, candidate_id, normalized_query) → atualiza.
   * Idempotente: confirmar um match já confirmado não altera dados.
   */
  async function createOrUpdateMatch(
    input: CreateOrUpdateMatchInput,
  ): Promise<SupplierProductMatch> {
    const sql = `
      INSERT INTO supplier_product_matches
        (supplier_id, candidate_id, query_text, normalized_query,
         match_status, match_score, confidence, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (supplier_id, candidate_id, normalized_query) DO UPDATE SET
        match_status = EXCLUDED.match_status,
        match_score  = COALESCE(EXCLUDED.match_score, supplier_product_matches.match_score),
        confidence   = COALESCE(EXCLUDED.confidence, supplier_product_matches.confidence),
        reason       = COALESCE(EXCLUDED.reason, supplier_product_matches.reason),
        updated_at   = NOW()
      RETURNING *
    `;
    const res = await queryFn(sql, [
      input.supplierId,
      input.candidateId,
      input.queryText,
      input.normalizedQuery,
      input.matchStatus,
      input.matchScore ?? null,
      input.confidence ?? null,
      input.reason ?? null,
    ]);
    return matchRowToApi(res.rows[0] as MatchRow);
  }

  return {
    upsertCandidate,
    listCandidatesByQuery,
    listReusableMatches,
    updateCandidateExtraction,
    createDiscoveryRun,
    finishDiscoveryRun,
    createOrUpdateMatch,
  };
}

/**
 * Tipo da API pública do serviço — usado para injeção/mock em código que o
 * consome (ex: catalogDiscovery).
 */
export type SupplierProductCatalogService = ReturnType<
  typeof createSupplierProductCatalogService
>;

/**
 * Instância singleton com a queryFn real do banco.
 * Importar direto quando não há necessidade de injeção.
 */
export const supplierProductCatalogService = createSupplierProductCatalogService();
