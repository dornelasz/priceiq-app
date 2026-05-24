/**
 * AIProviderStub — placeholder DESLIGADO do provider de IA (Etapa 5).
 *
 * Esta etapa cria apenas o contrato e a fundação. Gemini/IA real NÃO é
 * integrado aqui. Se este stub for chamado, responde imediatamente com status
 * 'disabled' e razão 'ai_provider_disabled' — sem chamada de rede e SEM exigir
 * GEMINI_API_KEY.
 *
 * Quando a IA real for ligada (etapa futura), ela atuará só como interpretadora
 * de conteúdo já coletado — nunca como fonte de preço — e lerá a chave de
 * process.env no backend (nunca no frontend, nunca no código).
 */
import type {
  AIProvider,
  AIProviderInput,
  AIProviderResult,
} from './aiProvider.js';

export const AI_DISABLED_REASON = 'ai_provider_disabled';

/**
 * Cria o stub do provider de IA, sempre desligado nesta etapa.
 */
export function createAIProviderStub(): AIProvider {
  return {
    name: 'ai_interpreter',
    enabled: false,
    async interpretProduct(_input: AIProviderInput): Promise<AIProviderResult> {
      void _input;
      return {
        status: 'disabled',
        errorMessage: AI_DISABLED_REASON,
        elapsedMs: 0,
      };
    },
  };
}
