/**
 * FirecrawlProviderStub — placeholder DESLIGADO do provider Firecrawl (Etapa 5).
 *
 * Esta etapa cria apenas o contrato e a fundação. O Firecrawl real NÃO é
 * integrado aqui. Se este stub for chamado, ele responde imediatamente com
 * status 'disabled' e a razão 'external_provider_disabled' — sem fazer
 * chamada de rede e SEM exigir FIRECRAWL_API_KEY.
 *
 * A integração real do Firecrawl como FetchProvider virá em etapa futura,
 * substituindo este stub, sempre lendo a chave de process.env (nunca do código).
 */
import type {
  FetchProvider,
  FetchProviderInput,
  FetchProviderResult,
} from './fetchProvider.js';

export const FIRECRAWL_DISABLED_REASON = 'external_provider_disabled';

/**
 * Cria o stub do provider Firecrawl, sempre desligado nesta etapa.
 */
export function createFirecrawlProviderStub(): FetchProvider {
  return {
    name: 'firecrawl',
    type: 'firecrawl',
    enabled: false,
    async fetchPage(input: FetchProviderInput): Promise<FetchProviderResult> {
      return {
        status: 'disabled',
        url: input.url,
        errorMessage: FIRECRAWL_DISABLED_REASON,
        elapsedMs: 0,
      };
    },
  };
}
