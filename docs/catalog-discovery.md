# Catalog Discovery

O Catalog Discovery é a camada que **popula automaticamente** o Supplier Product
Catalog (Etapa 14). Ele descobre URLs de produto por fornecedor usando várias
fontes e salva os candidatos no catálogo — exatamente como SaaS profissionais de
price monitoring fazem antes de raspar e comparar preços.

> Esta etapa **descobre e salva URLs**. Não extrai preço, não usa IA/Gemini, não
> conecta ao worker e não cria UI. Extração e monitoramento vêm depois.

---

## Por que existe

Descobrir onde um produto mora no site de um fornecedor é a parte cara da busca.
Em vez de redescobrir a cada execução, o discovery roda uma vez, salva os
candidatos no catálogo e deixa as próximas buscas reutilizarem o que já foi
encontrado (via `supplier_product_matches`).

```
runCatalogDiscovery
   ├─ 1. matches reutilizáveis (leitura) ── evita refazer trabalho
   ├─ 2. Firecrawl Search ── "{query} site:{domínio}"
   ├─ 3. Firecrawl Map ───── mapeia o domínio
   ├─ 4. Sitemap ─────────── /sitemap.xml, /sitemap_index.xml, robots.txt
   └─ 5. Search Page ─────── motor próprio (Etapa 6) raspando a busca
          │
          ▼
   mapper (ranker da Etapa 6) → upsertCandidate → supplier_product_candidates
                                                  + supplier_discovery_runs
```

---

## As quatro fontes

### Firecrawl Search (`source='firecrawl_search'`)

Usa o endpoint **`POST /v2/search`** da API Firecrawl com a query
`"{query} site:{domínioDoFornecedor}"`. Devolve uma lista de URLs + título +
descrição — **apenas links**, nunca preço. Disponível só com
`FIRECRAWL_ENABLED=true`. A chave vai exclusivamente no header `Authorization`.

### Firecrawl Map (`source='firecrawl_map'`)

Usa **`POST /v2/map`** para listar URLs do domínio do fornecedor, passando a
query em `search` para priorizar as mais relevantes. Bom para descobrir muitas
URLs de uma vez. Também exige `FIRECRAWL_ENABLED=true`.

### Sitemap (`source='sitemap'`)

Fonte **mais barata** quando disponível (sem créditos, sem IA). Tenta, em ordem:
1. `/robots.txt` → linhas `Sitemap: …`
2. `/sitemap.xml`
3. `/sitemap_index.xml`

Parseia os `<loc>`, segue índices de sitemap (limitado a poucos sub-sitemaps),
filtra para URLs com cara de produto do mesmo domínio. Limites de segurança
evitam baixar a internet inteira: no máximo 4 sitemaps tentados, 3 sub-sitemaps
por índice e 300 URLs coletadas. Se nada funcionar, devolve erro controlado —
nunca quebra o discovery.

### Search Page (`source='search_page'`)

Reaproveita o **motor próprio** (Etapa 6 + 11): constrói a URL de busca, busca o
HTML com um `FetchProvider` (NativeFetcher por padrão) e roda
`discoverProductUrls` para extrair candidatos. Não raspa páginas de produto.

---

## Como os candidatos são salvos

Toda URL descoberta passa pelo `mapDiscoveredUrlsToCandidates`:

1. `removeTrackingParams` — remove `utm_*`, `fbclid`, etc.
2. filtro de domínio — descarta URLs de outro site.
3. `scoreCandidateUrl` (ranker da Etapa 6) — pontua e mantém só `product`/`unknown`.
4. `hashProductUrl` — gera o `url_hash` (SHA-256) para deduplicar.
5. ordena por score, corta em `maxCandidates`.

Cada candidato vira um `upsertCandidate(source, status='candidate')`. Como o
upsert usa `ON CONFLICT (supplier_id, url_hash)`, **a mesma URL nunca duplica** —
uma segunda descoberta apenas atualiza status/score.

---

## Como os discovery_runs registram a execução

Para cada fonte executada, o orquestrador:

- chama `createDiscoveryRun(source)` no início (status inicial `completed`,
  `finished_at` NULL);
- ao terminar, chama `finishDiscoveryRun` com:
  - `status`: `completed` (salvou candidatos) · `no_candidates` (respondeu mas
    nada útil) · `blocked` (destino bloqueou) · `failed` (rate_limited/no_credits/
    timeout/error) · `partial` (erro mas algo foi salvo);
  - `candidates_found`: URLs retornadas pela fonte;
  - `candidates_saved`: candidatos persistidos;
  - `error_message`: causa controlada, quando houver.

Fontes indisponíveis (ex: Firecrawl desligado) são marcadas como `skipped` no
`sourceBreakdown` e **não** geram run.

---

## Rota de diagnóstico

```
POST /api/suppliers/:id/discover-catalog
Content-Type: application/json

{
  "query": "ssd 1tb nvme",
  "sources": ["firecrawl_search", "firecrawl_map", "sitemap", "search_page"],
  "maxCandidates": 20
}
```

- `sources` e `maxCandidates` são opcionais (default: todas as fontes, 20).
- Roda `runCatalogDiscovery`, salva candidatos e registra runs.
- Resposta é um **resumo sanitizado**: contadores, `sourceBreakdown`,
  `discoveryRunIds`, `errors` e `attempts` (com `detail` truncado).
- **Nunca** retorna HTML bruto nem a `FIRECRAWL_API_KEY`.

Exemplo de resposta:

```json
{
  "ok": true,
  "supplierId": "…",
  "supplierName": "Kabum",
  "query": "ssd 1tb nvme",
  "normalizedQuery": "ssd 1tb nvme",
  "reusableMatches": 0,
  "candidatesFound": 12,
  "candidatesSaved": 9,
  "candidatesRejected": 3,
  "sourceBreakdown": [
    { "source": "firecrawl_search", "runId": "…", "status": "completed",
      "fetchStatus": "success", "candidatesFound": 6, "candidatesSaved": 5,
      "candidatesRejected": 1 },
    { "source": "sitemap", "runId": "…", "status": "completed", "…": "…" }
  ],
  "discoveryRunIds": ["…", "…"],
  "errors": [],
  "attempts": [ { "step": "firecrawl_search", "status": "external_fetch_success", "…": "…" } ]
}
```

---

## O que NÃO foi implementado nesta etapa

- Extração de preço / monitoramento recorrente — vem depois.
- Gemini / IA — o discovery nunca chama IA.
- Worker real, UI nova, deploy manual.
- Playwright / Puppeteer / Jina / Diffbot.

---

## Como será usado nas próximas etapas

1. **Monitoramento**: um worker lê candidatos `validated`/`extracted` com
   `last_checked_at` antigo e reverifica preço — sem redescobrir URLs.
2. **Reaproveitamento**: `listReusableMatches` devolve matches `confirmed` para
   pular o discovery em queries recorrentes.
3. **Comparação de preço**: os candidatos validados alimentam a comparação entre
   fornecedores, fechando o ciclo do SaaS de price monitoring.

Veja também: [`docs/supplier-product-catalog.md`](./supplier-product-catalog.md).
