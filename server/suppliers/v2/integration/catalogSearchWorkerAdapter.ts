/**
 * catalogSearchWorkerAdapter — conecta o fluxo catalog-first (Etapa 17) ao
 * worker de busca (Etapa 18).
 *
 * Converte o CatalogSearchResult em um InsertResultPayload único, escolhendo o
 * melhor usefulResult (validated/partial) ou, na ausência destes, uma falha
 * controlada representativa. Reaproveita mapUniversalResultToInsertPayload para
 * manter as MESMAS regras de frete/cotação do fluxo de recipe:
 *   - frete desconhecido NUNCA vira 0;
 *   - total_brl null quando frete a confirmar;
 *   - price_brl preenchido via convertToBrl (Investing.com);
 *   - evidência e productUrl preservados;
 *   - nunca inventa preço/frete/link.
 *
 * `fallback=true` sinaliza ao worker para usar o fluxo de recipe anterior —
 * acontece SOMENTE em falha técnica (status='failed').
 */
import type { ResultStatus } from '../../../lib/resultStatus.js';
import type { InsertResultPayload } from '../../../services/searchService.js';
import type { UniversalSearchResult, FreightStatus } from '../types.js';
import type {
  CatalogSearchResult,
  UsefulResult,
  FailedResult,
} from '../searchEngine/catalogSearch/catalogSearchTypes.js';
import {
  mapUniversalResultToInsertPayload,
  type ConvertToBrl,
} from './workerAdapter.js';

const CATALOG_SOURCE_NAME = 'catalog_search';

export interface CatalogPayloadOutcome {
  /** Payload pronto para insertResult. null quando fallback=true. */
  payload: InsertResultPayload | null;
  /** true → o worker deve usar o fluxo de recipe (fallback técnico). */
  fallback: boolean;
  /**
   * UniversalSearchResult reconstruído do melhor usefulResult (para cache).
   * null em falhas / no_candidates.
   */
  universal: UniversalSearchResult | null;
}

function normalizeFreightStatus(s: string | null): FreightStatus {
  if (s === 'free_confirmed' || s === 'confirmed' || s === 'estimated') return s;
  return 'not_available';
}

/** Ordena: validated antes de partial; depois maior matchScore; depois menor preço. */
export function pickBestUseful(useful: UsefulResult[]): UsefulResult | null {
  if (useful.length === 0) return null;
  return [...useful].sort((a, b) => {
    const aVal = a.status === 'validated' ? 0 : 1;
    const bVal = b.status === 'validated' ? 0 : 1;
    if (aVal !== bVal) return aVal - bVal;
    const aScore = a.matchScore ?? 0;
    const bScore = b.matchScore ?? 0;
    if (aScore !== bScore) return bScore - aScore;
    const aPrice = a.price ?? Number.POSITIVE_INFINITY;
    const bPrice = b.price ?? Number.POSITIVE_INFINITY;
    return aPrice - bPrice;
  })[0]!;
}

const FAILURE_PRIORITY: Record<string, number> = {
  blocked: 1,
  product_mismatch: 2,
  price_not_found: 3,
  invalid_link: 4,
  timeout: 5,
  not_found: 6,
  error: 7,
};

/** Falha mais informativa primeiro (blocked > product_mismatch > …). */
export function pickRepresentativeFailure(
  failures: FailedResult[],
): FailedResult | null {
  if (failures.length === 0) return null;
  return [...failures].sort(
    (a, b) =>
      (FAILURE_PRIORITY[a.status] ?? 99) - (FAILURE_PRIORITY[b.status] ?? 99),
  )[0]!;
}

function usefulToUniversal(u: UsefulResult): UniversalSearchResult {
  return {
    found: true,
    // O mapper re-deriva 'partial' a partir do freightStatus — aqui é sempre
    // 'validated' porque o usefulResult já passou pela validação de evidência.
    status: 'validated',
    productName: u.productName ?? undefined,
    price: u.price,
    currency: u.currency,
    freight: u.freight,
    freightStatus: normalizeFreightStatus(u.freightStatus),
    totalPrice: null,
    productUrl: u.productUrl,
    linkType: 'product',
    linkValidated: true,
    matchScore: u.matchScore,
    confidence: u.confidence,
    available: null,
    warning: null,
    errorMessage: null,
    evidence: {
      sourceUrl: u.productUrl,
      sourceName: CATALOG_SOURCE_NAME,
      evidenceText: u.evidenceText ?? '',
      extractedAt: new Date().toISOString(),
      strategy: 'json_ld',
    },
  };
}

function failureMessage(status: string): string {
  switch (status) {
    case 'blocked':
      return 'fornecedor bloqueou o acesso ao produto';
    case 'product_mismatch':
      return 'produtos do catálogo não correspondem à busca';
    case 'price_not_found':
      return 'produto encontrado no catálogo mas sem preço confiável';
    case 'invalid_link':
      return 'link de produto inválido no catálogo';
    case 'timeout':
      return 'tempo esgotado ao processar candidatos do catálogo';
    case 'not_found':
      return 'nenhum produto correspondente no catálogo';
    default:
      return 'falha ao processar candidatos do catálogo';
  }
}

function controlledFailurePayload(
  status: ResultStatus,
  message: string,
  productUrl?: string | null,
): InsertResultPayload {
  return {
    found: false,
    status,
    errorMessage: message,
    fromCache: false,
    sourceName: CATALOG_SOURCE_NAME,
    sourceUrl: productUrl ?? undefined,
  };
}

/**
 * Converte o resultado do catalog-first em um payload único para o worker.
 * Nunca lança.
 */
export async function mapCatalogSearchResultToPayload(
  result: CatalogSearchResult,
  opts: { convertToBrl: ConvertToBrl },
): Promise<CatalogPayloadOutcome> {
  // Falha técnica → fallback ao fluxo de recipe.
  if (result.status === 'failed') {
    return { payload: null, fallback: true, universal: null };
  }

  // Nenhum candidato descoberto → not_found controlado (sem fallback).
  if (result.status === 'no_candidates') {
    return {
      payload: controlledFailurePayload(
        'not_found',
        result.recommendation ?? 'nenhum candidato encontrado no catálogo',
      ),
      fallback: false,
      universal: null,
    };
  }

  // Resultado útil → validated/partial (regras de frete via mapper).
  const best = pickBestUseful(result.usefulResults);
  if (best) {
    const universal = usefulToUniversal(best);
    const payload = await mapUniversalResultToInsertPayload({
      result: universal,
      convertToBrl: opts.convertToBrl,
      sourceName: CATALOG_SOURCE_NAME,
      fromCache: false,
    });
    return { payload, fallback: false, universal };
  }

  // Sem úteis, mas com falhas → falha controlada representativa.
  const failure = pickRepresentativeFailure(result.failures);
  if (failure) {
    return {
      payload: controlledFailurePayload(
        failure.status as ResultStatus,
        failureMessage(failure.status),
        failure.productUrl,
      ),
      fallback: false,
      universal: null,
    };
  }

  // Sem úteis e sem falhas → not_found controlado.
  return {
    payload: controlledFailurePayload(
      'not_found',
      'nenhum resultado útil no catálogo',
    ),
    fallback: false,
    universal: null,
  };
}
