# Catalog-First no Worker

A partir da Etapa 18, a **busca normal** do PriceIQ (a que roda quando o usuário
cria uma `search`) passa a usar o catálogo **primeiro**. O `priceSearchWorker`
prefere o fluxo catalog-first (Etapa 17) e mantém o fluxo de recipe anterior
como **fallback seguro**.

> Esta etapa **não faz deploy**. O deploy real (Railway + Supabase + Vercel)
> acontece na próxima etapa.

---

## Por que catalog-first

Antes, cada busca raspava o fornecedor do zero (recipe → fetch → extração).
Agora o worker aproveita o conhecimento já acumulado:

1. **Matches confirmados** são reutilizados — sem nova descoberta.
2. **Candidatos do catálogo** são re-raspados quando precisam de atualização.
3. Só quando não há nada salvo é que roda **discovery + processing** completos.

Isso aproxima o PriceIQ de SaaS profissionais (Jungle Scout, Semrush): um índice
construído uma vez e reaproveitado muitas, com menos consumo de créditos do
Firecrawl e respostas mais rápidas em buscas repetidas.

---

## Fluxo do worker por fornecedor

```
1. Cache (Redis) — hit válido → reusa como 'cached'
2. Carrega recipe; auto-configura se necessário
3. (recipe certificada)
3.5 CATALOG-FIRST  ← preferencial (Etapa 18)
     │
     ├─ runCatalogFirstSupplierSearch(supplier, query, recipe)
     │     • reused_matches  → atualiza candidatos conhecidos
     │     • discovered_then_processed → discovery + processing
     │
     ├─ status='failed' OU exception → FALLBACK ao passo 4
     └─ caso contrário → converte e persiste, FIM
4. runSupplierRecipe (FALLBACK) — fluxo anterior intacto
5. Persiste resultado
6. Cache
```

O passo 3.5 só roda quando `CATALOG_SEARCH_ENABLED=true` (default) **e** o
fornecedor já tem recipe certificada (garantido pelos passos 2–3).

---

## Como o resultado é convertido

`catalogSearchWorkerAdapter.mapCatalogSearchResultToPayload` transforma o
`CatalogSearchResult` em **um** `InsertResultPayload`:

| Resultado catalog-first | Payload persistido |
|---|---|
| `usefulResults` com `validated` | `validated` (melhor escolhido) |
| `usefulResults` com `partial` | `partial` (preço útil, total a confirmar) |
| `failures` `blocked` | `blocked` |
| `failures` `price_not_found` | `price_not_found` |
| `failures` `product_mismatch` | `product_mismatch` |
| `no_candidates` | `not_found` controlado |
| `status='failed'` (técnico) | **fallback** ao recipe |

Quando há vários `usefulResults`, escolhe-se o melhor: **validated antes de
partial**, depois maior `matchScore`, depois menor preço.

A conversão reaproveita `mapUniversalResultToInsertPayload`, então as regras de
frete e cotação são **exatamente as mesmas** do fluxo de recipe.

---

## Garantias preservadas

- **Frete desconhecido nunca vira 0** — `freight`/`total_brl` ficam null.
- **`price_brl` é preenchido via `convertToBrl`** (Investing.com) sempre que há
  preço + moeda — inclusive para fornecedores não-BRL (o catálogo só guarda
  `price_brl` para BRL; a conversão final acontece aqui).
- **Sem evidência → nunca é gravado como validated** (o usefulResult já exige
  `evidenceText` + `price`).
- **Nunca inventa preço/frete/link** — apenas repassa o que o catálogo extraiu.
- **`productUrl` e evidência são preservados** no payload.
- **HTML bruto nunca é persistido**; a `FIRECRAWL_API_KEY` nunca aparece.

---

## Fallback seguro

O fallback ao fluxo de recipe acontece **somente em falha técnica**:

- `runCatalogFirstSupplierSearch` lança exception, ou
- retorna `status='failed'` (erro de banco/discovery/processing).

Falhas de **negócio** (`no_candidates`, `no_matches`, `blocked`,
`product_mismatch`, `price_not_found`) **não** disparam fallback — elas são
resultados controlados legítimos e são persistidas como tal. Isso evita
trabalho duplicado e gasto extra de créditos.

O código antigo (`runSupplierRecipe`) **não foi removido** — continua como
caminho de fallback e como rota quando `CATALOG_SEARCH_ENABLED=false`.

---

## Flag de configuração

```bash
CATALOG_SEARCH_ENABLED=true   # default — usa catalog-first
CATALOG_SEARCH_ENABLED=false  # desliga — worker usa só o fluxo de recipe
```

Nos testes, `WorkerDeps.catalogSearchEnabled` sobrescreve o flag sem depender
de variável de ambiente, e `WorkerDeps.runCatalogSearch` injeta um mock — então
nenhum teste chama Firecrawl real, rede ou banco.

---

## Firecrawl e IA

- O **Firecrawl só roda se `FIRECRAWL_ENABLED=true`**, pela cadeia de providers
  já existente (Etapa 11). A chave vem de `process.env.FIRECRAWL_API_KEY`.
- **Gemini/IA continuam desligados.** O catalog-first usa apenas o
  `localProductExtractor` (cascata JSON-LD → DOM → markdown). Nenhuma IA,
  Playwright, Puppeteer, Jina ou Diffbot é chamada.

---

## Próxima etapa

Deploy real com Railway (backend), Supabase (Postgres) e Vercel (frontend):
configurar env vars (incluindo `CATALOG_SEARCH_ENABLED` e `FIRECRAWL_*`),
rodar as migrations do catálogo e validar a busca catalog-first em produção.
