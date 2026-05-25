/**
 * discoveryTypes — contratos da camada de descoberta de URLs de produto (Etapa 6).
 *
 * Tipos de entrada/saída do módulo de discovery, sem comportamento.
 */
import type { LinkClass } from '../../extractors/linkClassifier.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';
import type { Supplier } from '../../../../services/supplierService.js';
import type { SupplierRecipe } from '../../types.js';

/** Status de saída do processo de descoberta. */
export type DiscoveryStatus =
  | 'candidates_found'
  | 'no_candidates'
  | 'invalid_search_url'
  | 'blocked'
  | 'error';

/** Candidato de URL de produto rankeado com pontuação e razão. */
export interface RankedCandidate {
  url: string;
  score: number;
  linkClass: LinkClass;
  reason: string;
  queryTokensFound: number;
}

/** Resumo estatístico do processo de descoberta (para observabilidade). */
export interface DiscoveryDiagnostics {
  searchUrl: string | null;
  linksExtracted: number;
  linksRejected: number;
  /** Quantos links vieram de um provider externo (ex: Firecrawl). */
  linksFromProvider: number;
  rejectionReasons: Record<string, number>;
  topCandidates: Pick<RankedCandidate, 'url' | 'score' | 'linkClass'>[];
}

export interface DiscoverProductUrlsInput {
  supplier: Supplier;
  recipe?: SupplierRecipe | null;
  query: string;
  /** HTML da página de busca já obtido (sem fetch real nesta etapa). */
  searchPageHtml?: string;
  /** URL que originou o HTML (para resolver hrefs relativos). */
  searchPageUrl?: string;
  /** Links já descobertos por um provider (ex: Firecrawl formats:["links"]). */
  extraLinks?: string[];
  maxCandidates?: number;
}

export interface DiscoverProductUrlsResult {
  status: DiscoveryStatus;
  searchUrl: string | null;
  candidates: RankedCandidate[];
  diagnostics: DiscoveryDiagnostics;
  /** Log detalhado de cada passo usando SearchAttempt da Etapa 5. */
  attempts: SearchAttempt[];
  errorMessage?: string;
}
