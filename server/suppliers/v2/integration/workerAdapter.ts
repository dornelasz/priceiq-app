/**
 * Adaptador que conecta o Universal Adapter V2 ao worker/búsca atual.
 *
 * Responsabilidades:
 *  - Mapear `SearchResultStatusV2` → `ResultStatus` (status legado da Etapa 2).
 *  - Mapear `linkType` V2 → `'product'|'search'|'unverified'` legado.
 *  - Aplicar conversão de moeda usando o converter injetado (vem do
 *    searchService, sem tocar em currencyService).
 *  - Aplicar regra de frete e derivar status completo vs parcial:
 *      not_available  → freight=null, totalBrl=null, status='partial' (preço útil)
 *      estimated      → freight=null, totalBrl=null, status='partial' (com warning)
 *      free_confirmed → freight=0, totalPrice=price, totalBrl=brl, status='validated'
 *      confirmed      → freight=valor, totalBrl=brl+freight, status='validated'
 *    price_brl (preço convertido sem frete) é sempre preenchido quando há preço+moeda.
 *
 * Função PURA exceto pela chamada do `convertToBrl` injetado.
 *
 * NÃO toca em DB nem em rede diretamente.
 */
import type { ResultStatus } from '../../../lib/resultStatus.js';
import type { InsertResultPayload } from '../../../services/searchService.js';
import type {
  LinkType,
  SearchResultStatusV2,
  UniversalSearchResult,
} from '../types.js';
import { isValidatedUniversalSearchResult } from '../validators.js';

// ─── Conversor injetável (mesma assinatura de searchService.convertToBrl) ──

export type ConvertToBrl = (
  amount: number,
  currency: string,
) => Promise<{ brl: number; rate: number }>;

// ─── Mapeamento de status V2 → status legado ───────────────────────────
//
// O banco atual aceita os 9 status da Etapa 2 (sem CHECK constraint).
// V2 introduz `needs_supplier_setup` que mapeia para `'error'` com
// errorMessage explícito — sem migration nesta fase.

export interface StatusMapping {
  status: ResultStatus;
  errorMessage?: string;
}

export function mapV2StatusToLegacy(
  v2: SearchResultStatusV2,
  originalErrorMessage?: string | null,
): StatusMapping {
  switch (v2) {
    case 'validated':
      return { status: 'validated' };
    case 'cached':
      return { status: 'cached' };
    case 'not_found':
      return {
        status: 'not_found',
        errorMessage: originalErrorMessage ?? 'produto não encontrado',
      };
    case 'blocked':
      return {
        status: 'blocked',
        errorMessage: originalErrorMessage ?? 'fornecedor bloqueou acesso',
      };
    case 'invalid_link':
      return {
        status: 'invalid_link',
        errorMessage: originalErrorMessage ?? 'link de produto inválido',
      };
    case 'price_not_found':
      return {
        status: 'price_not_found',
        errorMessage:
          originalErrorMessage ?? 'preço não encontrado com segurança',
      };
    case 'product_mismatch':
      return {
        status: 'product_mismatch',
        errorMessage:
          originalErrorMessage ?? 'produto encontrado mas não corresponde',
      };
    case 'timeout':
      return {
        status: 'timeout',
        errorMessage: originalErrorMessage ?? 'fornecedor demorou demais',
      };
    case 'error':
      return {
        status: 'error',
        errorMessage:
          originalErrorMessage ?? 'erro técnico no fornecedor',
      };
    case 'needs_supplier_setup':
      // Sem status equivalente no banco — usamos 'error' com mensagem clara.
      return {
        status: 'error',
        errorMessage:
          'needs_supplier_setup: fornecedor precisa de configuração (V2 setup pendente). ' +
          (originalErrorMessage ?? ''),
      };
    default: {
      // Exhaustiveness: se um novo status V2 aparecer, falha em compile-time.
      const _exhaustive: never = v2;
      void _exhaustive;
      return { status: 'error', errorMessage: 'status V2 desconhecido' };
    }
  }
}

function mapLinkType(
  v2: LinkType,
  linkValidated: boolean,
): 'product' | 'search' | 'unverified' {
  if (v2 === 'product' && linkValidated) return 'product';
  if (v2 === 'search') return 'search';
  return 'unverified';
}

// ─── Mapeamento principal ──────────────────────────────────────────────

export interface MapInput {
  result: UniversalSearchResult;
  convertToBrl: ConvertToBrl;
  /** sourceName a registrar (ex: 'v2_recipe_runner', 'v2_autoconfig_setup'). */
  sourceName?: string;
  /** Se true, força from_cache=true no payload (cache hit V2). */
  fromCache?: boolean;
}

export async function mapUniversalResultToInsertPayload(
  input: MapInput,
): Promise<InsertResultPayload> {
  const r = input.result;
  const isValidated = isValidatedUniversalSearchResult(r);
  const mapped = mapV2StatusToLegacy(r.status, r.errorMessage ?? null);

  // Quando o V2 disse 'validated' mas o helper rejeitou, NÃO persistimos
  // como validated — protege contra resultados quebrados que passariam pela
  // mapagem ingênua. Vira 'invalid_link' com warning claro.
  if (r.status === 'validated' && !isValidated) {
    return {
      found: false,
      status: 'invalid_link',
      errorMessage:
        'V2 retornou status=validated mas falhou em isValidatedUniversalSearchResult',
      fromCache: false,
    };
  }

  // ─── Caminho validated (ou cached que já passou pela validação) ─────
  if (
    (r.status === 'validated' || r.status === 'cached') &&
    isValidated &&
    typeof r.price === 'number' &&
    r.price > 0 &&
    typeof r.currency === 'string' &&
    r.currency.trim() !== '' &&
    typeof r.productUrl === 'string' &&
    r.productUrl.trim() !== '' &&
    typeof r.productName === 'string' &&
    r.productName.trim() !== '' &&
    r.evidence
  ) {
    const { brl, rate } = await input.convertToBrl(r.price, r.currency);

    // price_brl = preço (sem frete) convertido. Disponível sempre que houver
    // preço + moeda — é o que o resultado parcial mostra quando não há total.
    const priceBrl = parseFloat(brl.toFixed(4));

    // Aplicar regra de frete (3+1 estados) → freight + totalPrice + totalBrl.
    // totalConfirmed=true só quando o total final é confiável (frete confirmado
    // ou grátis comprovado). Quando false → resultado é PARCIAL (total_brl null).
    let freight: number | undefined;
    let totalPrice: number | undefined;
    let totalBrl: number | undefined;
    let totalConfirmed = false;
    let freightWarning: string | undefined;

    switch (r.freightStatus) {
      case 'free_confirmed':
        freight = 0;
        totalPrice = parseFloat(r.price.toFixed(4));
        totalBrl =
          rate > 0 ? parseFloat((totalPrice * rate).toFixed(4)) : brl;
        totalConfirmed = true;
        break;
      case 'confirmed': {
        const fv =
          typeof r.freight === 'number' && r.freight > 0 ? r.freight : 0;
        if (fv > 0) {
          freight = fv;
          totalPrice = parseFloat((r.price + fv).toFixed(4));
          totalBrl =
            rate > 0
              ? parseFloat((totalPrice * rate).toFixed(4))
              : brl + fv;
          totalConfirmed = true;
        } else {
          // contrato V2 já reforça > 0 em confirmed; defensivo → trata como parcial
          freight = undefined;
          totalPrice = undefined;
          totalBrl = undefined;
          freightWarning =
            'freightStatus=confirmed mas freight inválido — tratando como a confirmar';
        }
        break;
      }
      case 'estimated':
        // estimated NÃO confirma total — gravamos warning, sem freight no payload.
        freight = undefined;
        totalPrice = undefined;
        totalBrl = undefined;
        freightWarning = 'frete estimado (não confirmado)';
        break;
      case 'not_available':
      default:
        // Frete desconhecido: NUNCA usa 0. Não preenche totalPrice/totalBrl.
        freight = undefined;
        totalPrice = undefined;
        totalBrl = undefined;
        freightWarning = 'Preço encontrado, frete a confirmar.';
        break;
    }

    // Status final: completo (validated/cached) só com total confirmado;
    // caso contrário é parcial (preço útil, frete pendente).
    const finalStatus: ResultStatus = totalConfirmed
      ? input.fromCache
        ? 'cached'
        : 'validated'
      : 'partial';

    const v2Warning = r.warning ?? undefined;
    const warning =
      [v2Warning, freightWarning].filter((w): w is string => !!w).join(' · ') ||
      undefined;

    return {
      found: true,
      status: finalStatus,
      productName: r.productName,
      price: r.price,
      currency: r.currency.toUpperCase(),
      freight,
      totalPrice,
      exchangeRateUsed: rate > 0 ? rate : undefined,
      totalBrl,
      priceBrl,
      productUrl: r.productUrl,
      matchScore: typeof r.matchScore === 'number' ? r.matchScore : undefined,
      confidence:
        typeof r.confidence === 'number'
          ? Math.round(r.confidence)
          : undefined,
      available: r.available ?? undefined,
      warning,
      fromCache: input.fromCache ?? false,
      linkType: mapLinkType(r.linkType, r.linkValidated),
      linkValidated: r.linkValidated,
      evidenceText: r.evidence.evidenceText,
      sourceUrl: r.evidence.sourceUrl,
      sourceName: input.sourceName ?? r.evidence.sourceName ?? 'v2_recipe_runner',
      validationWarning: r.warning ?? undefined,
    };
  }

  // ─── Caminho falha controlada ───────────────────────────────────────
  return {
    found: false,
    status: mapped.status,
    errorMessage: mapped.errorMessage,
    fromCache: false,
    // Preserva linkType/sourceName/evidência parcial quando V2 tinha algo:
    linkType: r.linkType === 'product' && r.linkValidated ? 'product' : undefined,
    sourceUrl: r.evidence?.sourceUrl,
    sourceName: input.sourceName,
    validationWarning: r.warning ?? undefined,
  };
}
