# Deploy do backend (`server/`) no Render

Guia para colocar a API Fastify do PriceIQ no Render — incluindo a rota de
diagnóstico do motor próprio (`/api/suppliers/:id/test-own-search`) e o
Firecrawl opcional. **Nenhum secret vai para o GitHub**: as chaves ficam só no
dashboard do Render.

> Esta etapa NÃO conecta o motor ao worker real, NÃO mexe no frontend, NÃO toca
> na cotação. É só preparar o backend para subir.

---

## 1. Criar o Web Service

Há dois caminhos equivalentes:

### A) Manual (recomendado para começar)
1. Render → **New +** → **Web Service** → conecte o repo `dornelasz/priceiq-app`.
2. **Root Directory:** `server`
3. **Runtime:** Node
4. **Build Command:** `npm install --include=dev && npm run build`
5. **Start Command:** `npm run db:migrate && npm run start`
6. **Health Check Path:** `/api/health`
7. Defina as variáveis de ambiente (seção 3) e crie.

### B) Blueprint (`render.yaml`)
1. Render → **New +** → **Blueprint** → aponte para o repo.
2. O Render lê `render.yaml` (na raiz) e cria o serviço `priceiq-server`.
3. Ele vai pedir os valores das variáveis marcadas como secret (`sync: false`).

> `render.yaml` é ignorado no deploy manual — ter o arquivo no repo não quebra a
> opção A.

### Por que `--include=dev` no build
Com `NODE_ENV=production`, o `npm install` puro **omite** as `devDependencies`.
Como o build (`tsc`) e a migração (`tsx`) dependem de `typescript`/`tsx` (que são
devDependencies), o build falharia. `--include=dev` garante que estejam presentes
(e permanecem no runtime para o `db:migrate`).

---

## 2. Comandos e caminhos

| Item | Valor |
|---|---|
| Root Directory | `server` |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm run db:migrate && npm run start` |
| Health Check Path | `/api/health` |
| Node | `>=20` (definido em `server/package.json` → `engines`) |

- `npm run build` → `tsc` compila para `server/dist/`.
- `npm run start` → `node dist/index.js` (roda a versão buildada).
- `npm run db:migrate` → aplica as migrations antes de subir (idempotente).

---

## 3. Variáveis de ambiente

### Obrigatórias em produção
| Variável | Exemplo | Observação |
|---|---|---|
| `NODE_ENV` | `production` | Ativa as checagens de CORS de produção. |
| `DATABASE_URL` | `postgresql://user:pass@ep-xxx.neon.tech/priceiq?sslmode=require` | Postgres (Neon). **Secret.** |
| `FRONTEND_URL` | `https://priceiq.vercel.app` | URL da Vercel, **sem barra final**. Sem ela (ou apontando para localhost) o servidor recusa subir em produção. |

> `PORT` é injetada pelo Render — **não** defina.

### Opcionais
| Variável | Padrão | Observação |
|---|---|---|
| `CORS_ORIGIN` | `''` | Origens CSV; se definida, tem precedência sobre `FRONTEND_URL`. |
| `REDIS_URL` | — | Cache. Ausente/inacessível → cai para cache em memória. |
| `FIRECRAWL_ENABLED` | `false` | Liga o Firecrawl como coletor principal do motor próprio. |
| `FIRECRAWL_API_KEY` | `''` | **Obrigatória SE** `FIRECRAWL_ENABLED=true` (senão o boot falha com erro claro). **Secret.** |
| `FIRECRAWL_API_URL` | `https://api.firecrawl.dev/v2` | Override só para self-hosted. |
| `FETCH_PROVIDER_PRIORITY` | `firecrawl,native` | Ordem dos coletores. |
| `FIRECRAWL_TIMEOUT_MS` | `60000` | Timeout por scrape. |
| `FIRECRAWL_MAX_PAGES_PER_SEARCH` | `5` | Teto de páginas Firecrawl por busca. |
| `FIRECRAWL_MAX_CREDITS_PER_SEARCH` | `10` | Teto de créditos estimados por busca. |

> A `FIRECRAWL_API_KEY` é usada **somente** no header `Authorization` do
> FirecrawlProvider. Ela nunca aparece em logs, no diagnostics ou na resposta da
> API. **Nunca** a coloque em arquivos do repositório — só no dashboard do Render.

---

## 4. Testar depois do deploy

### Saúde
```bash
curl https://<seu-backend>.onrender.com/api/health
# { "ok": true, "service": "priceiq-server", "environment": "production", ... }

curl https://<seu-backend>.onrender.com/api/db/health
```

### Rota de diagnóstico do motor próprio
A rota precisa de um fornecedor existente. Crie um, pegue o `id` e teste:

```bash
# 1. Criar fornecedor
curl -X POST https://<seu-backend>.onrender.com/api/suppliers \
  -H 'content-type: application/json' \
  -d '{"name":"Kabum","site":"www.kabum.com.br",
       "search_url_template":"https://www.kabum.com.br/busca?query={q}",
       "currency":"BRL"}'
# → resposta traz "id": "<uuid>"

# 2. Testar o motor próprio (GET é o mais simples)
curl "https://<seu-backend>.onrender.com/api/suppliers/<uuid>/test-own-search?query=ssd%201tb%20nvme"
```

A resposta traz `status`, `result`, o bloco `provider`
(`priority`, `firecrawlEnabled`, `usedFallback`, `providerUsed`) e os
`attempts` — **sem HTML bruto e sem a API key**. Veja a interpretação completa
em [`docs/search-engine-testing.md`](./search-engine-testing.md).

### Testar com Firecrawl real
1. No dashboard do Render, defina `FIRECRAWL_ENABLED=true` e `FIRECRAWL_API_KEY=fc-...`.
2. Salve (o serviço reinicia).
3. Repita o passo 2 acima. No JSON, `provider.firecrawlEnabled` deve ser `true` e,
   se o site não bloquear, `provider.providerUsed` deve ser `firecrawl`.

---

## 5. Checklist de produção

- [ ] **Backend sobe** — deploy fica *Live* sem erro no log.
- [ ] **`/api/health` responde** `{ ok: true, environment: "production" }`.
- [ ] **Banco conecta** — `/api/db/health` OK e o `db:migrate` rodou sem erro.
- [ ] **CORS permite a Vercel** — `FRONTEND_URL` (ou `CORS_ORIGIN`) = URL exata
      do frontend, sem barra final; chamadas do browser não dão erro de CORS.
- [ ] **Firecrawl só com chave** — com `FIRECRAWL_ENABLED=true` e **sem**
      `FIRECRAWL_API_KEY`, o boot falha com mensagem clara (comportamento esperado).
- [ ] **`test-own-search` não vaza chave** — a resposta não contém a
      `FIRECRAWL_API_KEY` nem HTML bruto.
- [ ] **Cotação intacta** — `/api/rates` continua respondendo via Investing.com,
      sem alteração.
- [ ] **Sem secrets no GitHub** — nenhuma chave/DSN commitada; tudo no dashboard.

---

## 6. Segurança

- Não commite `.env` (já está no `.gitignore`). Use `server/.env.example` como modelo.
- `DATABASE_URL` e `FIRECRAWL_API_KEY` são secrets → só no dashboard do Render
  (no `render.yaml` aparecem como `sync: false`, sem valor).
- A entrada real do SaaS é `web/` (Vercel) + `server/` (Render). `legacy/index.html`
  e o `index.html` da raiz **não** são deployados — ver
  [`docs/deployment-entrypoint.md`](./deployment-entrypoint.md).
