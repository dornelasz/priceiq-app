/**
 * pipelineResultMapper — traduções de status do pipeline próprio (Etapa 7).
 *
 * Duas responsabilidades puras:
 *   1. mapear o status de coleta (FetchProviderStatus) → status V2 controlado;
 *   2. classificar o resultado de extração para o diagnostics interno
 *      (validated vs partial via freightStatus; rejected; extraction_failed).
 *
 * Funções PURAS.
 */
import type { SearchResultStatusV2, UniversalSearchResult } from '../../types.js';
import type { FetchProviderStatus } from '../providers/fetchProvider.js';
import type { SearchEngineInternalStatus } from '../core/searchEngineStatus.js';

/**
 * Mapeia uma falha de coleta para o status V2 controlado correspondente.
 * 'success' não deveria chegar aqui (é tratado como caminho feliz); por
 * defesa, mapeia para 'error'.
 */
export function mapFetchStatusToResultStatus(
  status: FetchProviderStatus,
  errorMessage?: string,
): { status: SearchResultStatusV2; message: string } {
  switch (status) {
    case 'blocked':
      return { status: 'blocked', message: errorMessage ?? 'fornecedor bloqueou acesso' };
    case 'timeout':
      return { status: 'timeout', message: errorMessage ?? 'tempo de busca esgotado' };
    case 'not_found':
      return { status: 'not_found', message: errorMessage ?? 'página de busca não encontrada' };
    case 'rate_limited':
      return { status: 'error', message: errorMessage ?? 'provider externo atingiu limite de requisições' };
    case 'no_credits':
      return { status: 'error', message: errorMessage ?? 'provider externo sem créditos' };
    case 'disabled':
      return { status: 'error', message: errorMessage ?? 'provider de coleta desligado' };
    case 'success':
    case 'error':
    default:
      return { status: 'error', message: errorMessage ?? 'falha técnica na coleta' };
  }
}

/**
 * Classifica o resultado do localProductExtractor em um status interno para
 * o diagnostics. Um 'validated' com frete não confirmado é registrado como
 * 'partial' (preço útil, total a confirmar) — espelhando a regra da Etapa 3,
 * sem alterar o status V2 do resultado em si.
 */
export function classifyExtractionForDiagnostics(
  result: UniversalSearchResult,
): SearchEngineInternalStatus {
  switch (result.status) {
    case 'validated':
      return result.freightStatus === 'confirmed' ||
        result.freightStatus === 'free_confirmed'
        ? 'validated'
        : 'partial';
    case 'product_mismatch':
      return 'rejected';
    case 'price_not_found':
    case 'invalid_link':
    case 'not_found':
      return 'extraction_failed';
    case 'blocked':
      return 'blocked';
    case 'timeout':
      return 'timeout';
    default:
      return 'error';
  }
}

/** Resultado de extração é útil (produto + preço, completo ou parcial)? */
export function isUsefulExtraction(result: UniversalSearchResult): boolean {
  return result.status === 'validated';
}
