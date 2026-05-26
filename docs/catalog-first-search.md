# Catalog-First Search

O Catalog-First Search é a estratégia de busca principal do PriceIQ como SaaS
profissional de monitoramento de preços. Em vez de refazer todo o trabalho a
cada consulta, o sistema **aproveita o conhecimento acumulado** — URLs validadas,
matches confirmados — e só faz discovery completo quando necessário.

> Esta etapa **não conecta ao priceSearchWorker real**, não cria UI nova e
> não usa IA/Gemini.

---

## O ciclo completo

```
catalog-search
  │
  ├─ matches confirmados existem?
  │      SIM → process-catalog (só esses candidatos) → usefulResults
  │      NÃO ↓
  │
  ├─ discover-catalog (Firecrawl Search/Map + Sitemap + Search Page)
  │      │
  │      └─ candidatos salvos? NÃO → no_candidates + recomendação
  │                            SIM ↓
  │
  └─ process-catalog (todos os novos candidatos) → usefulResults
```

---

## Por que isso importa para um SaaS profissional

Em ferramentas como a Jungle Scout (Amazon) ou Semrush (SEO), não se varre o
mundo do zero a cada busca — usa-se um índice construído progressivamente.
O PriceIQ faz o mesmo:

1. **Discovery uma vez** — as URLs de produto de cada fornecedor são salvas em
   `supplier_product_candidates`.
2. **Matches validados persistem** — após o primeiro ciclo bem-sucedido,
   `supplier_product_matches` guarda os vínculos `(fornecedor, query, URL)`.
3. **Buscas subsequentes usam o índice** — a próxima busca pelo mesmo produto
   no mesmo fornecedor simplesmente atualiza os candidatos conhecidos, sem
   varrer tudo do zero. Muito mais rápido e com menos consumo de créditos
   do Firecrawl.

---

## Estratégias de busca

### `reused_matches`

Quando existem `supplier_product_matches` com `match_status = 'confirmed'`
para a query + fornecedor:

- Pega os `candidateId` desses matches.
- Roda `processCatalogCandidates` apenas nesses candidatos (atualiza preço +
  evidência).
- Retorna os resultados atualizados como `usefulResults`.
- Discovery **não é rodado** — economiza créditos e tempo.

### `discovered_then_processed`

Quando não há matches confirmados:

- Roda `runCatalogDiscovery` (Firecrawl Search/Map → Sitemap → Search Page).
- Salva candidatos novos em `supplier_product_candidates`.
- Roda `processCatalogCandidates` nesses candidatos.
- Cria `supplier_product_matches` para os que passam no threshold de score.
- Na próxima busca, esses matches serão reutilizados.

---

## O que são `usefulResults`

Um candidato vira `usefulResult` quando:

- `candidateStatus` é `'validated'` ou `'partial'`
- Tem `evidenceText` não-vazio
- Tem `price` não-nulo

Candidatos `product_mismatch`, `price_not_found`, `blocked` etc. vão para
`failures`.

### Regras de frete (invioláveis)

- **Frete desconhecido nunca vira 0.** `freight = null`, `totalBrl = null`.
- **Frete grátis comprovado** → `freight = 0`, `totalBrl = price`.
- **Frete confirmado** → `freight = valor`, `totalBrl = price + freight`.
- **Parcial** (`partial`) → preço disponível, total a confirmar.

---

## Rota `POST /api/suppliers/:id/catalog-search`

```json
{
  "query": "ssd 1tb nvme",
  "maxReusableMatches": 5,
  "maxDiscoveryCandidates": 20,
  "maxProcessingCandidates": 5,
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
  "strategy": "reused_matches",
  "reusedMatchesCount": 2,
  "candidatesDiscovered": 0,
  "candidatesProcessed": 2,
  "matchesCreated": 0,
  "usefulResults": [
    {
      "candidateId": "…",
      "productUrl": "https://www.kabum.com.br/produto/111",
      "productName": "SSD Kingston A2000 1TB NVMe",
      "price": 299.9,
      "currency": "BRL",
      "priceBrl": 299.9,
      "freight": 0,
      "freightStatus": "free_confirmed",
      "totalBrl": 299.9,
      "matchScore": 85,
      "confidence": 90,
      "evidenceText": "SSD Kingston 1TB NVMe M.2 — R$ 299,90 frete grátis",
      "status": "validated",
      "matchStatus": "confirmed"
    }
  ],
  "failures": [],
  "diagnostics": {
    "reusableMatchesFound": 2,
    "candidatesDiscoveredBySource": {},
    "processingStatusBreakdown": { "validated": 2 },
    "attemptCount": 4
  },
  "errors": [],
  "attempts": []
}
```

A rota:
- **não cria** Search normal nem salva SearchResult;
- **não mexe** na cotação;
- **não retorna** HTML bruto;
- **não vaza** a `FIRECRAWL_API_KEY`;
- quando não há candidatos, devolve `no_candidates` + recomendação de rodar
  `discover-catalog` primeiro.

---

## Status possíveis

| Status | Significado |
|---|---|
| `completed` | ≥1 usefulResult, sem erros |
| `partial` | ≥1 usefulResult mas com erros |
| `no_candidates` | Discovery retornou 0 candidatos |
| `no_matches` | Processamento rodou mas 0 resultados úteis |
| `failed` | Erro técnico que abortou o fluxo |

---

## O que NÃO foi implementado nesta etapa

- Conexão definitiva no `priceSearchWorker` real.
- Frontend novo.
- Gemini / IA / Playwright / Puppeteer / Jina / Diffbot.
- Comparação de preços entre múltiplos fornecedores.
- Worker recorrente / monitoramento agendado.

---

## Como prepara as próximas etapas

O `catalog-search` é o ponto de entrada do loop de monitoramento:

```
catalog-search → usefulResults → comparação entre fornecedores → alerta de preço
```

Com matches `confirmed` acumulados, buscas futuras do mesmo produto passam
pelo path `reused_matches` — custando apenas o tempo de re-raspar URLs já
conhecidas, sem novo discovery.
