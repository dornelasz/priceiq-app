/**
 * catalogDiscoveryMapper — transforma URLs descobertas (de qualquer fonte) em
 * objetos prontos para upsertCandidate (Etapa 15).
 *
 * Reaproveita o ranker/classificador da Etapa 6:
 *   - removeTrackingParams  → limpa utm_*, fbclid, etc.
 *   - scoreCandidateUrl     → pontua 0–100 (classe + tokens + domínio + path)
 *   - classifyUrl (via score) → mantém só 'product' | 'unknown'
 *
 * Deduplica por url_hash, filtra domínio do fornecedor, ordena por score e
 * limita a maxCandidates.
 *
 * Função PURA — sem rede, sem DB (apenas hashProductUrl, que é local/crypto).
 */
import { getSupplierDomain } from '../discovery/candidateUrlExtractor.js';
import { removeTrackingParams } from '../discovery/candidateUrlExtractor.js';
import { scoreCandidateUrl } from '../discovery/candidateUrlRanker.js';
import { hashProductUrl } from '../../catalog/index.js';
import type { Supplier } from '../../../../services/supplierService.js';
import type {
  SupplierProductSource,
  UpsertCandidateInput,
} from '../../catalog/index.js';
import type { DiscoveredUrl } from './catalogDiscoveryTypes.js';

const DEFAULT_MAX_CANDIDATES = 20;

function isSameDomain(urlStr: string, supplierDomain: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    const normalized = host.startsWith('www.') ? host.slice(4) : host;
    return normalized === supplierDomain || normalized.endsWith(`.${supplierDomain}`);
  } catch {
    return false;
  }
}

/**
 * Mapeia URLs descobertas em candidatos do catálogo, rankeados e deduplicados.
 * Mantém apenas URLs do mesmo domínio do fornecedor classificadas como
 * 'product' ou 'unknown' (regra do ranker da Etapa 6).
 */
export function mapDiscoveredUrlsToCandidates(
  urls: DiscoveredUrl[],
  supplier: Supplier,
  queryText: string,
  normalizedQuery: string,
  source: SupplierProductSource,
  maxCandidates: number = DEFAULT_MAX_CANDIDATES,
): UpsertCandidateInput[] {
  const supplierDomain = getSupplierDomain(supplier);
  const seenHashes = new Set<string>();
  const scored: Array<{ score: number; input: UpsertCandidateInput }> = [];

  for (const discovered of urls) {
    const cleaned = removeTrackingParams(discovered.url.trim());
    if (!/^https?:\/\//i.test(cleaned)) continue;
    if (!isSameDomain(cleaned, supplierDomain)) continue;

    const { score, linkClass } = scoreCandidateUrl(cleaned, queryText, supplierDomain);
    if (linkClass !== 'product' && linkClass !== 'unknown') continue;

    const urlHash = hashProductUrl(cleaned);
    if (seenHashes.has(urlHash)) continue;
    seenHashes.add(urlHash);

    scored.push({
      score,
      input: {
        supplierId: supplier.id,
        queryText,
        normalizedQuery,
        productUrl: cleaned,
        urlHash,
        source,
        status: 'candidate',
        matchScore: score,
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates)
    .map((s) => s.input);
}
