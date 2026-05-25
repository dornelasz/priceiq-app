# Testando o Motor Próprio de Busca

A rota `POST /api/suppliers/:id/test-own-search` (e sua variante GET) executa o
pipeline próprio do PriceIQ em isolamento para um fornecedor e produto específicos.

**O que ela FAZ:**
- Dispara o motor nativo (NativeFetcher + localProductExtractor)
- Retorna o resultado, as URLs candidatas encontradas e os passos de diagnóstico
- Indica se o preço foi validado, parcialmente encontrado ou não encontrado

**O que ela NÃO FAZ:**
- Não salva nenhum resultado no banco de dados
- Não usa Firecrawl, Gemini, IA ou qualquer serviço externo
- Não altera nem consulta a cotação de moedas
- Não interfere no fluxo de buscas real (`/api/searches`)

---

## Exemplos de uso

### POST (recomendado)

```bash
curl -s -X POST \
  https://<seu-backend>.onrender.com/api/suppliers/<uuid>/test-own-search \
  -H 'Content-Type: application/json' \
  -d '{"query": "notebook dell inspiron 15"}' | jq .
```

### GET (conveniência, útil no browser)

```
GET /api/suppliers/<uuid>/test-own-search?query=notebook+dell+inspiron+15
```

---

## Estrutura da resposta

```jsonc
{
  "ok": true,
  "supplierId": "aaaaaaaa-...",
  "supplierName": "Kabum",
  "query": "notebook dell inspiron 15",

  // Status de diagnóstico (ver tabela abaixo)
  "status": "validated",

  // null quando não houve erro; mensagem de falha controlada nos demais casos
  "errorMessage": null,

  "result": {
    "productName": "Notebook Dell Inspiron 15 3000",
    "price": 2799.90,
    "currency": "BRL",
    "priceBrl": 2799.90,     // só preenchido quando currency = BRL
    "freight": 0,
    "freightStatus": "free_confirmed",
    "totalPrice": 2799.90,
    "totalBrl": 2799.90,
    "productUrl": "https://kabum.com.br/produto/123",
    "evidenceText": "Notebook Dell Inspiron 15 3000…",  // truncado a 500 chars
    "matchScore": 0.91,
    "confidence": 0.87,
    "available": true
  },

  "diagnostics": {
    // URLs de produto descobertas na página de busca
    "candidateUrls": [
      "https://kabum.com.br/produto/123",
      "https://kabum.com.br/produto/456"
    ],

    // Passos do pipeline, em ordem cronológica
    "attempts": [
      {
        "step": "search_fetch",
        "status": "fetched",
        "providerName": "native",
        "url": "https://kabum.com.br/busca?q=notebook+dell",
        "elapsedMs": 820,
        "at": "2026-05-25T14:30:00.000Z"
      },
      {
        "step": "product_fetch",
        "status": "fetched",
        "providerName": "native",
        "url": "https://kabum.com.br/produto/123",
        "elapsedMs": 610,
        "at": "2026-05-25T14:30:01.000Z"
      }
    ],

    "elapsedMs": 1450,
    "budgetUsage": {
      "nativeFetches": 2,
      "totalFetches": 2,
      "extractions": 1,
      "elapsedMs": 1450
    }
  }
}
```

---

## Tabela de status

| Status              | Significado                                                          |
|---------------------|----------------------------------------------------------------------|
| `validated`         | Preço encontrado + frete confirmado (grátis ou valor)                |
| `partial`           | Preço encontrado, mas frete não confirmado (estimado ou desconhecido)|
| `not_found`         | Nenhum candidato encontrado na página de busca                       |
| `blocked`           | O site retornou captcha / Cloudflare challenge                       |
| `price_not_found`   | Produto encontrado, mas sem preço extraível                          |
| `product_mismatch`  | Resultado mais próximo não bateu com a query (score baixo)           |
| `timeout`           | Fetch excedeu o tempo limite do orçamento                            |
| `error`             | Erro inesperado durante o pipeline                                   |
| `needs_supplier_setup` | Fornecedor sem `site` válido configurado                          |
| `invalid_link`      | URL candidata inválida ou fora do domínio esperado                   |

---

## O que analisar nos `attempts`

- **`search_fetch` com `status: blocked`** → o site está protegido; considere
  adicionar um `search_url_template` mais específico ou usar um proxy.
- **Poucos `candidateUrls`** → o seletor CSS de links da página de busca pode
  precisar de ajuste (campo `productUrlPatterns` na receita).
- **`product_fetch` com `status: timeout`** → as páginas de produto são lentas;
  aumente `budget.maxElapsedMs` na receita ou verifique a latência do servidor.
- **`extraction_failed`** → o extrator não encontrou preço; verifique se o
  produto tem JSON-LD schema.org ou ajuste os seletores na receita.

---

## Observações

- O campo `priceBrl` e `totalBrl` só são preenchidos quando `currency = "BRL"`.
  Para fornecedores internacionais eles ficam `null` — a conversão real ocorre
  no fluxo principal, que usa a cotação do dia.
- `evidenceText` é truncado a 500 caracteres para evitar resposta muito grande.
- Detalhes nos `attempts` são truncados a 300 caracteres.
- A chave `FIRECRAWL_API_KEY` nunca aparece em nenhuma resposta desta rota.
