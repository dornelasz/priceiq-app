/**
 * diagnosticResponseMapper — molda a saída do pipeline próprio para a resposta
 * da rota de diagnóstico (Etapa 8).
 *
 * Garantias de segurança:
 *   - NUNCA expõe HTML bruto da página (o resultado universal já não o carrega).
 *   - evidenceText é truncado; attempts têm `detail` truncado.
 *   - Não há conversão de moeda aqui (não mexe na cotação): priceBrl/totalBrl
 *     só refletem o valor quando a moeda já é BRL; caso contrário ficam null
 *     (a conversão real continua sendo responsabilidade do worker/searchService).
 *
 * O status de diagnóstico deriva 'partial' de um 'validated' com frete não
 * confirmado, espelhando a regra da Etapa 3 sem alterar o status V2 do result.
 *
 * Funções PURAS.
 */
import type { UniversalSearchResult } from '../../types.js';
import type { OwnSearchPipelineOutcome } from './pipelineTypes.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';
import type { BudgetUsage } from '../core/searchBudget.js';

export type DiagnosticStatus =
  | 'validated'
  | 'partial'
  | 'cached'
  | 'not_found'
  | 'blocked'
  | 'invalid_link'
  | 'price_not_found'
  | 'product_mismatch'
  | 'timeout'
  | 'error'
  | 'needs_supplier_setup';

const EVIDENCE_MAX = 500;
const DETAIL_MAX = 300;

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Deriva o status de diagnóstico. Um 'validated' com frete não confirmado
 * (not_available/estimated) é reportado como 'partial' — preço útil, total a
 * confirmar. Os demais status V2 passam direto.
 */
export function deriveDiagnosticStatus(
  result: UniversalSearchResult,
): DiagnosticStatus {
  if (result.status === 'validated') {
    return result.freightStatus === 'confirmed' ||
      result.freightStatus === 'free_confirmed'
      ? 'validated'
      : 'partial';
  }
  return result.status as DiagnosticStatus;
}

export interface DiagnosticResultView {
  productName: string | null;
  price: number | null;
  currency: string | null;
  priceBrl: number | null;
  freight: number | null;
  freightStatus: string;
  totalPrice: number | null;
  totalBrl: number | null;
  productUrl: string | null;
  evidenceText: string | null;
  matchScore: number | null;
  confidence: number | null;
  available: boolean | null;
}

function toResultView(r: UniversalSearchResult): DiagnosticResultView {
  const isBrl = (r.currency ?? '').toUpperCase() === 'BRL';
  const price = typeof r.price === 'number' ? r.price : null;
  const totalPrice = typeof r.totalPrice === 'number' ? r.totalPrice : null;
  return {
    productName: r.productName ?? null,
    price,
    currency: r.currency ?? null,
    // Sem cotação: só ecoamos BRL quando a moeda já é BRL.
    priceBrl: isBrl ? price : null,
    freight: typeof r.freight === 'number' ? r.freight : null,
    freightStatus: r.freightStatus,
    totalPrice,
    totalBrl: isBrl ? totalPrice : null,
    productUrl: r.productUrl ?? null,
    evidenceText: truncate(r.evidence?.evidenceText, EVIDENCE_MAX),
    matchScore: typeof r.matchScore === 'number' ? r.matchScore : null,
    confidence: typeof r.confidence === 'number' ? r.confidence : null,
    available: r.available ?? null,
  };
}

export interface SanitizedAttempt {
  step: string;
  status: string;
  providerName?: string;
  url?: string;
  detail?: string;
  elapsedMs?: number;
  httpStatus?: number;
  usedFallback?: boolean;
  fallbackReason?: string;
  linksFromProvider?: number;
  at: string;
}

/** Remove qualquer risco de HTML bruto e trunca mensagens longas. */
export function sanitizeAttempts(attempts: SearchAttempt[]): SanitizedAttempt[] {
  return attempts.map((a) => ({
    step: a.step,
    status: a.status,
    ...(a.providerName ? { providerName: a.providerName } : {}),
    ...(a.url ? { url: a.url } : {}),
    ...(a.detail ? { detail: truncate(a.detail, DETAIL_MAX) ?? undefined } : {}),
    ...(typeof a.elapsedMs === 'number' ? { elapsedMs: a.elapsedMs } : {}),
    ...(typeof a.httpStatus === 'number' ? { httpStatus: a.httpStatus } : {}),
    ...(a.usedFallback ? { usedFallback: true } : {}),
    ...(a.fallbackReason ? { fallbackReason: a.fallbackReason } : {}),
    ...(typeof a.linksFromProvider === 'number'
      ? { linksFromProvider: a.linksFromProvider }
      : {}),
    at: a.at,
  }));
}

/** Qual provider entregou o conteúdo terminal (último fetch de sucesso)? */
function deriveProviderUsed(attempts: SearchAttempt[]): string | null {
  const successSteps = new Set(['search_fetch', 'product_fetch']);
  let last: string | null = null;
  for (const a of attempts) {
    if (
      successSteps.has(a.step) &&
      (a.status === 'native_fetch_success' || a.status === 'external_fetch_success') &&
      a.providerName
    ) {
      last = a.providerName;
    }
  }
  return last;
}

export interface DiagnosticProviderView {
  /** Ordem de tentativa dos providers (ex: ['firecrawl','native']). */
  priority: string[];
  /** Firecrawl estava ligado nesta execução? */
  firecrawlEnabled: boolean;
  /** Algum passo caiu para um provider de fallback? */
  usedFallback: boolean;
  /** Provider que entregou o conteúdo terminal (null se nenhum). */
  providerUsed: string | null;
}

export interface DiagnosticResponse {
  ok: boolean;
  supplierId: string;
  supplierName: string;
  query: string;
  status: DiagnosticStatus;
  errorMessage: string | null;
  result: DiagnosticResultView;
  provider: DiagnosticProviderView;
  diagnostics: {
    candidateUrls: string[];
    attempts: SanitizedAttempt[];
    elapsedMs: number;
    budgetUsage: BudgetUsage;
  };
}

export interface MapDiagnosticInput {
  supplierId: string;
  supplierName: string;
  query: string;
  outcome: OwnSearchPipelineOutcome;
}

/**
 * Constrói a resposta de diagnóstico sanitizada a partir do outcome do
 * pipeline próprio.
 */
export function mapToDiagnosticResponse(
  input: MapDiagnosticInput,
): DiagnosticResponse {
  const { outcome } = input;
  return {
    ok: true,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    query: input.query,
    status: deriveDiagnosticStatus(outcome.result),
    errorMessage: outcome.result.errorMessage ?? null,
    result: toResultView(outcome.result),
    provider: {
      priority: outcome.providerPriority ?? [],
      firecrawlEnabled: outcome.firecrawlEnabled ?? false,
      usedFallback: outcome.usedFallback ?? false,
      providerUsed: deriveProviderUsed(outcome.attempts),
    },
    diagnostics: {
      candidateUrls: outcome.candidateUrls,
      attempts: sanitizeAttempts(outcome.attempts),
      elapsedMs: outcome.elapsedMs,
      budgetUsage: outcome.context.budgetUsage,
    },
  };
}
