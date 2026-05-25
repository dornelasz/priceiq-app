# Supplier Product Catalog

O Supplier Product Catalog é a base persistente do PriceIQ como SaaS profissional
de price monitoring. Ele resolve o problema de descoberta redundante: sem ele, cada
busca recomeça do zero, desperdiçando tempo e créditos de APIs externas (Firecrawl).

---

## Por que existe

Em SaaS de monitoramento de preços profissional, a descoberta de URLs de produtos
é cara (requer fetch de páginas de busca e seguimento de links). O catálogo
elimina trabalho repetido:

- Uma URL de produto já validada não precisa ser redescoberta.
- Um match confirmado (produto X = URL Y para o query Z) pode ser reutilizado
  diretamente em buscas futuras.
- O histórico de execuções permite auditoria e diagnóstico de falhas.

Sem catálogo: cada busca = 1 fetch de página de busca + N fetches de candidatos.
Com catálogo: buscas recorrentes da mesma query = 0 fetches (serve do cache de matches confirmados).

---

## Três tabelas, três responsabilidades

### `supplier_product_candidates`

Armazena **URLs candidatas** de produtos, uma por combinação `(supplier_id, url_hash)`.

- `url_hash` é SHA-256 da URL normalizada (trim + lowercase), garante deduplicação.
- `status` evolui ao longo do ciclo de vida: `candidate` → `extracted` → `validated`
  (ou `blocked`, `price_not_found`, `product_mismatch`, `rejected`, `partial`).
- `evidence_text` e `price_evidence_text` guardam trechos de texto onde o preço
  foi encontrado — nunca HTML bruto, truncados em 2 000 caracteres.
- `first_seen_at` nunca é sobrescrito (imutável por design).
- `last_checked_at` é atualizado a cada verificação de extração.

Índices: `supplier_id`, `normalized_query`, `status`, `last_checked_at`.

### `supplier_product_matches`

Registra o **resultado do matching** entre uma query de busca e um candidato.
Deduplicado por `(supplier_id, candidate_id, normalized_query)`.

- `match_status`: `pending` (ainda não avaliado) → `confirmed` (produto certo)
  ou `rejected` (produto errado ou acessório).
- `match_score` e `confidence` permitem ordenar matches por qualidade.
- Um match confirmado (`confirmed`) é o que `listReusableMatches` devolve para
  pular a etapa de busca em queries recorrentes.

### `supplier_discovery_runs`

Registra cada execução do pipeline de discovery — criado no início
(`createDiscoveryRun`) e finalizado no fim (`finishDiscoveryRun`).

- `candidates_found`: total descoberto nesta execução.
- `candidates_saved`: quantos foram persistidos (upsert) com sucesso.
- `error_message`: captura a causa de falha sem apagar dados já salvos.
- `finished_at`: NULL enquanto o run está em andamento.

---

## Como candidate difere de match

| | `candidate` | `match` |
|---|---|---|
| O que é | Uma URL que pode ter o produto | Confirmação de que a URL tem o produto para esta query |
| Criado quando | Discovery encontra a URL | Extração + matching confirmam o produto |
| Lifetime | Persiste entre queries | Ligado a uma (query, URL) específica |
| Deduplicação | Por URL (url_hash) | Por (candidate, query) |

Um mesmo candidato pode ter vários matches — um por query diferente que o encontrou.

---

## Ciclo de vida completo de uma URL

```
Discovery encontra URL
        │
        ▼
upsertCandidate(status='candidate')
        │
        ▼
Fetch + localProductExtractor
        │
        ├─ sucesso → updateCandidateExtraction(status='validated'/'partial')
        │                     └─ createOrUpdateMatch(match_status='confirmed')
        │
        └─ falha  → updateCandidateExtraction(status='blocked'/'price_not_found'/...)
```

---

## Como evita duplicar URLs

1. `hashProductUrl(url)` produz SHA-256 de `url.trim().toLowerCase()` — qualquer
   variação de case ou espaço gera o mesmo hash.
2. `upsertCandidate` usa `INSERT ... ON CONFLICT (supplier_id, url_hash) DO UPDATE`.
   Se a URL já existe, atualiza status/score/updated_at sem criar nova linha.
3. `createOrUpdateMatch` usa `INSERT ... ON CONFLICT (supplier_id, candidate_id, normalized_query) DO UPDATE`.
   Confirmar o mesmo match duas vezes é idempotente.

---

## Como prepara o PriceIQ para funcionar como SaaS profissional

| Fase futura | Como o catálogo ajuda |
|---|---|
| Firecrawl Search | URLs descobertas via `firecrawl_search` → upsert com source='firecrawl_search' |
| Firecrawl Map | Mapa completo de URLs → upsert com source='firecrawl_map' |
| Sitemap | URLs do sitemap do fornecedor → upsert com source='sitemap' |
| Monitoramento recorrente | Worker consulta candidatos com `status='validated'` + `last_checked_at` antigo → reverifica apenas URLs conhecidas |
| Cache de resultado | `listReusableMatches` devolve matches confirmados para pular busca completa |
| Histórico de preço | Cada `updateCandidateExtraction` pode gerar linha em tabela futura `price_history` |

---

## Funções puras (sem I/O)

- **`normalizeCatalogQuery(query)`** — mesma lógica do motor de busca: minúsculas,
  sem acentos, sem pontuação, espaços colapsados.
- **`hashProductUrl(url)`** — SHA-256 de 64 chars, estável e determinístico.
- **`truncateEvidenceText(text)`** — limita a 2 000 chars; retorna `null` se vazio.
- **`mapRankedCandidatesToCatalog(candidates, supplier, query, normalizedQuery, source)`** —
  converte `RankedCandidate[]` do discovery em `UpsertCandidateInput[]`, sem I/O.

---

## Arquivos criados (Etapa 14)

| Arquivo | Responsabilidade |
|---|---|
| `server/db/migrations/0006_supplier_product_catalog.sql` | DDL das 3 tabelas + índices + triggers |
| `server/suppliers/v2/catalog/catalogTypes.ts` | Interfaces e literal unions TypeScript |
| `server/suppliers/v2/catalog/supplierProductCatalogService.ts` | Serviço com queryFn injetável |
| `server/suppliers/v2/catalog/candidateMapper.ts` | Mapper puro RankedCandidate → UpsertCandidateInput |
| `server/suppliers/v2/catalog/index.ts` | Barrel do módulo catalog |
| `server/tests/supplierProductCatalog.test.ts` | 16 testes (funções puras + serviço mockado) |
| `docs/supplier-product-catalog.md` | Esta documentação |
| `server/db/schema.sql` | Atualizado com as 3 novas tabelas |
