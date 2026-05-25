/**
 * catalogCandidateProcessor — raspa UMA product_url do catálogo e extrai o
 * produto (Etapa 16).
 *
 * Reaproveita a cadeia de providers da Etapa 11 (Firecrawl → NativeFetcher) e o
 * localProductExtractor da Etapa 4. NUNCA usa IA. NUNCA lança: falhas de coleta
 * viram status controlado.
 *
 * O preço/frete/match continuam 100% no localProductExtractor — o provider só
 * entrega html/markdown.
 */
import { extractLocalProduct } from '../../extractors/localProductExtractor.js';
import { fetchThroughProviders } from '../pipeline/providerChain.js';
import { classifyExtractionForDiagnostics } from '../pipeline/pipelineResultMapper.js';
import {
  addDiagnosticAttempt,
  type SearchEngineContext,
} from '../core/searchEngineContext.js';
import { makeSearchAttempt } from '../diagnostics/searchAttempt.js';
import { decideMatch, type MatchDecision } from './catalogMatchBuilder.js';
import type { FetchProvider } from '../providers/fetchProvider.js';
import type { Supplier } from '../../../../services/supplierService.js';
import type { SupplierRecipe } from '../../types.js';
import type { UniversalSearchResult } from '../../types.js';
import type { CandidateProcessingStatus } from './catalogProcessingTypes.js';

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host.length > 0 && host !== 'localhost' && host.includes('.');
  } catch {
    return false;
  }
}

export interface ProcessOneInput {
  candidateId: string;
  productUrl: string;
  supplier: Supplier;
  recipe?: SupplierRecipe | null;
  query: string;
  minMatchScore: number;
  trustedScore: number;
  timeoutMs?: number;
}

export interface ProcessOneOutcome {
  processingStatus: CandidateProcessingStatus;
  /** Presente quando a extração rodou (houve conteúdo). */
  result?: UniversalSearchResult;
  decision?: MatchDecision;
  /** true para falhas de coleta (blocked/timeout/error) antes da extração. */
  fetchFailed: boolean;
  errorMessage?: string;
}

/**
 * Raspa e extrai um único candidato. Registra attempts no contexto compartilhado.
 */
export async function processOneCandidate(
  input: ProcessOneInput,
  providers: FetchProvider[],
  context: SearchEngineContext,
): Promise<ProcessOneOutcome> {
  if (!isValidHttpUrl(input.productUrl)) {
    addDiagnosticAttempt(
      context,
      makeSearchAttempt({
        step: 'candidate_url',
        status: 'rejected',
        url: input.productUrl,
        detail: 'product_url inválida',
      }),
    );
    return { processingStatus: 'invalid_link', fetchFailed: false };
  }

  const chain = await fetchThroughProviders(
    providers,
    { url: input.productUrl, timeoutMs: input.timeoutMs },
    context,
    'candidate_fetch',
  );
  const fetched = chain.result;

  if (fetched.status === 'blocked') {
    return { processingStatus: 'blocked', fetchFailed: true, errorMessage: fetched.errorMessage };
  }
  if (fetched.status === 'timeout') {
    return { processingStatus: 'timeout', fetchFailed: true, errorMessage: fetched.errorMessage };
  }
  if (fetched.status !== 'success' || (!fetched.html && !fetched.markdown)) {
    return {
      processingStatus: 'error',
      fetchFailed: true,
      errorMessage: fetched.errorMessage ?? 'coleta falhou sem conteúdo',
    };
  }

  const productUrl = fetched.finalUrl ?? input.productUrl;
  const result = extractLocalProduct({
    url: productUrl,
    supplier: input.supplier,
    query: input.query,
    html: fetched.html,
    markdown: fetched.markdown,
    preferredStrategy: input.recipe?.extractionStrategy,
    minMatchScore: input.minMatchScore,
  });

  addDiagnosticAttempt(
    context,
    makeSearchAttempt({
      step: 'extraction',
      status: classifyExtractionForDiagnostics(result),
      url: productUrl,
      detail: result.errorMessage ?? `status: ${result.status}`,
    }),
  );

  const decision = decideMatch(result, {
    minMatchScore: input.minMatchScore,
    trustedScore: input.trustedScore,
  });

  return {
    processingStatus: decision.processingStatus,
    result,
    decision,
    fetchFailed: false,
  };
}
