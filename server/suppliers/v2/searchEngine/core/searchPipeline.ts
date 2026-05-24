/**
 * searchPipeline — decisões de fluxo do motor próprio (Etapa 5 — fundação).
 *
 * Esta etapa NÃO executa busca real nem integra o motor ao worker (isso é
 * etapa futura). Aqui ficam apenas as decisões PURAS que orquestram o
 * pipeline "motor próprio primeiro":
 *
 *   1. nativo (motor próprio)  → sempre prioridade quando habilitado
 *   2. fetcher externo (Firecrawl) → só se policy ligar E orçamento permitir
 *                                    E (opcional) o motor próprio já tiver falhado
 *   3. IA → só se policy ligar E orçamento permitir
 *
 * Com os defaults da Etapa 5 (firecrawlEnabled=false, aiEnabled=false,
 * maxExternalFetches=0, maxAiCalls=0), shouldTryExternalFetcher e shouldTryAI
 * retornam SEMPRE false — o motor roda 100% no nativo + extrator local.
 *
 * Funções PURAS.
 */
import type { SearchEngineContext } from './searchEngineContext.js';
import { hasBudgetRemaining } from './searchBudget.js';
import type { FetchProvider } from '../providers/fetchProvider.js';

/** Estágios ordenados do pipeline do motor próprio (motor próprio primeiro). */
export const SEARCH_PIPELINE_STAGES = [
  'classify_link',
  'native_fetch',
  'local_extraction',
  'match',
  'external_fetch_fallback',
  'ai_interpret_fallback',
  'finalize',
] as const;

export type SearchPipelineStage = (typeof SEARCH_PIPELINE_STAGES)[number];

/**
 * O motor próprio (nativo) já falhou nesta execução? Olha o diagnostics em
 * busca de fetch nativo que não teve sucesso (falha/bloqueio/timeout). Base
 * para `allowExternalOnlyAfterOwnFailure`.
 */
export function ownEngineFailed(context: SearchEngineContext): boolean {
  return context.diagnostics.attempts.some(
    (a) =>
      a.providerName === 'native_fetch' &&
      (a.status === 'native_fetch_failed' ||
        a.status === 'blocked' ||
        a.status === 'timeout'),
  );
}

/**
 * Deve tentar um fetcher EXTERNO (Firecrawl)? Falso por padrão na Etapa 5.
 *
 * Só verdadeiro quando: policy liga firecrawl, há orçamento de externalFetch,
 * e — se exigido — o motor próprio já falhou. Como o default tem
 * firecrawlEnabled=false e maxExternalFetches=0, retorna false.
 */
export function shouldTryExternalFetcher(context: SearchEngineContext): boolean {
  const policy = context.providerPolicy;
  if (!policy.firecrawlEnabled) return false;
  if (!hasBudgetRemaining(context, 'externalFetch')) return false;
  if (policy.allowExternalOnlyAfterOwnFailure && !ownEngineFailed(context)) {
    return false;
  }
  return true;
}

/**
 * Deve tentar IA? Falso por padrão na Etapa 5.
 *
 * Só verdadeiro quando policy liga IA e há orçamento de aiCall. Default tem
 * aiEnabled=false e maxAiCalls=0 → retorna false.
 */
export function shouldTryAI(context: SearchEngineContext): boolean {
  const policy = context.providerPolicy;
  if (!policy.aiEnabled) return false;
  if (!hasBudgetRemaining(context, 'aiCall')) return false;
  return true;
}

/**
 * Seleciona o FetchProvider a usar AGORA, respeitando "motor próprio primeiro".
 *
 * Prioriza o provider nativo habilitado enquanto houver orçamento nativo.
 * Só devolve um provider externo quando `shouldTryExternalFetcher` permite.
 * Devolve null quando nenhum provider é elegível (ex: nativo esgotado e
 * externo desligado) — sinal para o pipeline encerrar de forma controlada.
 */
export function selectFetchProvider(
  context: SearchEngineContext,
  providers: FetchProvider[],
): FetchProvider | null {
  const policy = context.providerPolicy;

  const native = providers.find((p) => p.type === 'native' && p.enabled);
  if (
    policy.nativeFetcherEnabled &&
    native &&
    hasBudgetRemaining(context, 'nativeFetch')
  ) {
    return native;
  }

  if (shouldTryExternalFetcher(context)) {
    const external = providers.find((p) => p.type !== 'native' && p.enabled);
    if (external) return external;
  }

  return null;
}
