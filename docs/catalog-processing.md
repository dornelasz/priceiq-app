# Catalog Processing

O Catalog Processing é a etapa que **transforma candidatos em matches**. Depois
que o [Catalog Discovery](./catalog-discovery.md) descobre e salva URLs no
[Supplier Product Catalog](./supplier-product-catalog.md), o processing raspa
essas URLs, extrai produto/preço/frete e grava `supplier_product_matches`.

> Esta etapa **raspa candidatos já salvos e cria matches**. Não conecta ao
> worker real, não cria UI, não mexe na cotação e não usa IA/Gemini.

---

## O ciclo completo

```
discover-catalog  →  process-catalog  →  (futuro) reuso em buscas
  encontra URLs       raspa + extrai        matches confirmados
  (candidates)        cria matches          evitam refazer tudo
```

- **discover-catalog** (Etapa 15): encontra URLs de produto e salva como
  `supplier_product_candidates` (status `candidate`).
- **process-catalog** (Etapa 16, esta): pega esses candidatos, raspa cada
  `product_url`, extrai com o `localProductExtractor`, valida o match com a
  query e grava `supplier_product_matches`.
- **buscas futuras**: matches `confirmed` são reutilizados — o PriceIQ não
  precisa pesquisar tudo do zero.

---

## Como `processCatalogCandidates` funciona

1. `listCandidatesByQuery(supplierId, normalizedQuery)` busca os candidatos.
   - `candidateIds` opcional filtra para candidatos específicos.
   - `maxCandidates` (default 5) limita quantos são processados.
2. Para cada candidato:
   - raspa a `product_url` pela **cadeia de providers** (Firecrawl → NativeFetcher);
   - passa o `html`/`markdown` ao `localProductExtractor` (Etapa 4);
   - decide o match (`catalogMatchBuilder`);
   - atualiza o candidato (`updateCandidateExtraction`);
   - grava o match (`createOrUpdateMatch`) quando aplicável.
3. Sem candidatos → status `no_candidates` + recomendação de rodar
   `discover-catalog` antes.

---

## Como os candidatos são raspados

A coleta reutiliza a cadeia da Etapa 11 (`fetchThroughProviders`):

- **Firecrawl** primeiro quando `FIRECRAWL_ENABLED=true` (os grandes sites
  bloqueiam o fetch direto).
- **NativeFetcher** como fallback (ou único, quando Firecrawl desligado).
- **IA nunca** é usada. A chave do Firecrawl fica só no header `Authorization`.

Falhas de coleta viram status controlado:
`blocked` (destino bloqueou) · `timeout` · `error`. O orçamento (`SearchBudget`)
limita o total de fetches por execução.

---

## Como o `localProductExtractor` é usado

O extractor é o **cérebro local** — recebe `html`/`markdown` já coletados e
devolve um `UniversalSearchResult`. O provider (incluindo Firecrawl) **nunca**
decide preço, frete ou link: ele só entrega o conteúdo. A cascata de extração
(JSON-LD → meta → __NEXT_DATA__ → script JSON → DOM → markdown) e o matching com
a query são 100% locais, mantendo as Etapas 3/4.

---

## Como os matches são criados

`createOrUpdateMatch` grava o vínculo `(supplier_id, candidate_id, normalized_query)`:

| Resultado da extração | Status do candidato | Match criado | `match_status` |
|---|---|---|---|
| validated + frete confirmado/grátis | `validated` | sim | `confirmed` (score alto) ou `pending` (médio) |
| validated + frete desconhecido | `partial` | sim | `confirmed`/`pending` |
| product_mismatch | `product_mismatch` | sim | `rejected` |
| price_not_found | `price_not_found` | não | — |
| invalid_link / not_found | `rejected` | não | — |
| blocked | `blocked` | não | — |

Match só é criado para validated/partial quando há **evidência + preço +
productUrl + score ≥ minMatchScore**. `confirmed` quando o score ≥
`MATCH_SCORE_TRUSTED` (75); `pending` quando está entre `minMatchScore` e 75.

---

## Como partial / validated / rejected são decididos

- **validated**: produto + preço + moeda + evidência, frete **confirmado** ou
  **grátis**. Total final confirmável.
- **partial**: tudo de validated, mas **frete desconhecido**. Preço é útil, o
  total fica a confirmar. Frete desconhecido **nunca vira 0** — fica `null`.
- **rejected / product_mismatch**: produto incompatível com a query (ou
  acessório quando a query pede o produto principal), ou sem evidência.

Regras invioláveis preservadas:
- frete desconhecido nunca vira 0;
- sem evidência → nunca gravado como validated;
- HTML bruto nunca é salvo (só o `evidence_text`, truncado);
- a `FIRECRAWL_API_KEY` nunca aparece em diagnostics/resposta.

---

## Rota `POST /api/suppliers/:id/process-catalog`

```json
{
  "query": "ssd 1tb nvme",
  "maxCandidates": 5,
  "minMatchScore": 70
}
```

Resposta (resumo sanitizado):

```json
{
  "ok": true,
  "supplierId": "…",
  "supplierName": "Kabum",
  "query": "ssd 1tb nvme",
  "normalizedQuery": "ssd 1tb nvme",
  "status": "completed",
  "candidatesProcessed": 5,
  "candidatesUpdated": 5,
  "matchesCreated": 2,
  "matchesRejected": 1,
  "statusBreakdown": { "validated": 2, "product_mismatch": 1, "price_not_found": 2 },
  "processed": [ { "candidateId": "…", "productUrl": "…", "status": "validated", "matchStatus": "confirmed" } ],
  "errors": [],
  "attempts": [ { "step": "candidate_fetch", "status": "native_fetch_success", "…": "…" } ]
}
```

A rota:
- processa candidatos **já salvos** (não cria search normal, não grava SearchResult);
- não mexe na cotação;
- não retorna HTML bruto;
- não vaza a `FIRECRAWL_API_KEY`;
- quando não há candidatos, devolve `no_candidates` + recomendação de rodar
  `discover-catalog` primeiro.

---

## O que NÃO foi implementado nesta etapa

- Worker real / monitoramento recorrente.
- Frontend novo.
- Gemini / IA / Playwright / Puppeteer / Jina / Diffbot.
- Comparação final de preço entre fornecedores (próxima etapa).

---

## Como prepara as próximas etapas

Os matches `confirmed` viram a base de reuso: `listReusableMatches` devolve, em
buscas futuras, as URLs já validadas para a query — fechando o ciclo do SaaS de
price monitoring (descobrir uma vez, monitorar/comparar muitas).
