/**
 * candidateMapper — transforma candidatos do productUrlDiscovery em objetos
 * prontos para upsertCandidate do Supplier Product Catalog (Etapa 14).
 *
 * Função pura: sem I/O, sem DB, sem rede.
 */

import type { Supplier } from '../../../services/supplierService.js';
import type { RankedCandidate } from '../searchEngine/discovery/discoveryTypes.js';
import { hashProductUrl } from './supplierProductCatalogService.js';
import type { SupplierProductSource, UpsertCandidateInput } from './catalogTypes.js';

/**
 * Converte um array de RankedCandidate em UpsertCandidateInput[], prontos
 * para serem persistidos via supplierProductCatalogService.upsertCandidate.
 *
 * @param candidates   Lista ranqueada do productUrlDiscovery
 * @param supplier     Fornecedor dono dos candidatos
 * @param queryText    Query original (sem normalizar)
 * @param normalizedQuery Query já normalizada
 * @param source       Origem dos candidatos (default: 'search_page')
 */
export function mapRankedCandidatesToCatalog(
  candidates: RankedCandidate[],
  supplier: Supplier,
  queryText: string,
  normalizedQuery: string,
  source: SupplierProductSource = 'search_page',
): UpsertCandidateInput[] {
  return candidates.map((candidate) => ({
    supplierId: supplier.id,
    queryText,
    normalizedQuery,
    productUrl: candidate.url,
    urlHash: hashProductUrl(candidate.url),
    source,
    status: 'candidate' as const,
    matchScore: candidate.score,
  }));
}
