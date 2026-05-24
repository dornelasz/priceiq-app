/**
 * Status internos do motor próprio de busca (Etapa 5 — fundação).
 *
 * Estes status descrevem CADA passo do pipeline interno (coleta → extração →
 * validação) e alimentam o diagnostics em memória. Eles NÃO substituem o
 * `SearchResultStatusV2` público — `mapInternalStatusToPublicStatus` traduz o
 * status interno terminal para o contrato V2 já existente.
 *
 * Decisão importante (preserva Etapas 3 e 4):
 *   - O V2 'validated' é AGNÓSTICO de frete. Tanto o status interno 'validated'
 *     quanto 'partial' mapeiam para V2 'validated'; a derivação de partial vs
 *     completo continua acontecendo no workerAdapter (Etapa 3), baseada no
 *     freightStatus. Assim o motor próprio não duplica essa regra.
 *
 * Função PURA — sem rede, DB ou IA.
 */
import type { SearchResultStatusV2 } from '../../types.js';

export const SEARCH_ENGINE_INTERNAL_STATUSES = [
  'candidate_found',
  'candidate_not_found',
  'native_fetch_success',
  'native_fetch_failed',
  'external_provider_disabled',
  'ai_provider_disabled',
  'extracted',
  'extraction_failed',
  'validated',
  'partial',
  'rejected',
  'blocked',
  'timeout',
  'error',
] as const;

export type SearchEngineInternalStatus =
  (typeof SEARCH_ENGINE_INTERNAL_STATUSES)[number];

/** Status internos que indicam um resultado ÚTIL (tem preço para mostrar). */
const USEFUL_INTERNAL = new Set<SearchEngineInternalStatus>([
  'validated',
  'partial',
]);

/**
 * Resultado útil = produto com preço (completo ou parcial). Espelha a
 * semântica de `isUsefulStatus` da Etapa 3 no nível do motor interno.
 */
export function isUsefulInternalStatus(
  s: SearchEngineInternalStatus | null | undefined,
): boolean {
  return !!s && USEFUL_INTERNAL.has(s);
}

/** Status internos que representam falha controlada (não um crash genérico). */
const CONTROLLED_FAILURE_INTERNAL = new Set<SearchEngineInternalStatus>([
  'candidate_not_found',
  'native_fetch_failed',
  'external_provider_disabled',
  'ai_provider_disabled',
  'extraction_failed',
  'rejected',
  'blocked',
  'timeout',
]);

/**
 * Falha CONTROLADA: o motor sabe por que não validou. Distingue de 'error'
 * (crash inesperado). Garante que "controlled failure não vira erro genérico".
 */
export function isControlledFailureStatus(
  s: SearchEngineInternalStatus | null | undefined,
): boolean {
  return !!s && CONTROLLED_FAILURE_INTERNAL.has(s);
}

/**
 * Traduz o status interno terminal para o `SearchResultStatusV2` público.
 *
 * 'validated' e 'partial' → V2 'validated' (frete-agnóstico; o partial é
 * derivado depois no workerAdapter). Status intermediários de progresso
 * (candidate_found, native_fetch_success, extracted) mapeiam para o
 * equivalente público mais conservador — eles existem sobretudo para o
 * diagnostics, mas a função é TOTAL para nunca lançar.
 */
export function mapInternalStatusToPublicStatus(
  s: SearchEngineInternalStatus,
): SearchResultStatusV2 {
  switch (s) {
    case 'validated':
    case 'partial':
      return 'validated';
    case 'rejected':
      return 'product_mismatch';
    case 'extraction_failed':
      return 'price_not_found';
    case 'blocked':
      return 'blocked';
    case 'timeout':
      return 'timeout';
    case 'error':
      return 'error';
    case 'candidate_not_found':
    case 'candidate_found':
    case 'native_fetch_success':
    case 'extracted':
    case 'external_provider_disabled':
    case 'ai_provider_disabled':
      // Estados sem produto confirmado e sem crash → "nada encontrado".
      return 'not_found';
    case 'native_fetch_failed':
      return 'error';
    default: {
      const _exhaustive: never = s;
      void _exhaustive;
      return 'error';
    }
  }
}
