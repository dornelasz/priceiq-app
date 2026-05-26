# Deploy: Railway + Supabase + Vercel + Firecrawl

Guia do deploy de produção do PriceIQ. **Nenhum secret fica neste arquivo** —
todos os valores sensíveis (DATABASE_URL, FIRECRAWL_API_KEY, etc.) são
configurados nos dashboards de cada serviço.

Arquitetura:

```
Vercel (web/, Next.js)  ──HTTP──>  Railway (server/, Fastify)  ──SQL──>  Supabase (Postgres)
                                          │
                                          └── Firecrawl (provider de coleta, opcional)
```

---

## 1. Supabase (Postgres) — FEITO

- Projeto: **priceiq-app** · org `dornelasz's Org` · região **sa-east-1** (São Paulo) · plano free.
- Migrations 0001–0006 aplicadas; tabelas validadas:
  `suppliers`, `searches`, `search_results`, `exchange_rates`, `app_settings`,
  `supplier_recipes`, `supplier_product_candidates`, `supplier_product_matches`,
  `supplier_discovery_runs` (+ `_migrations` com as 6 versões registradas).
- Como o app rastreia migrations em `_migrations`, o `db:migrate` do Railway
  vê tudo aplicado e **não re-executa** nada.

### Obter a DATABASE_URL (manual — não pode ser commitada)

No dashboard do Supabase: **Project Settings → Database → Connection string →
URI** (use a string do **pooler**, porta 6543, para serverless/Railway). Formato:

```
postgresql://postgres.<ref>:<PASSWORD>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
```

Cole esse valor em `DATABASE_URL` no Railway. **Nunca** coloque no repo.

> RLS está desabilitado nas tabelas. Como o backend acessa via `DATABASE_URL`
> (conexão direta/role postgres) e o frontend fala só com a API do Railway
> (não usa a anon key do Supabase no browser), o risco prático é baixo.
> Se quiser endurecer, habilite RLS + políticas no dashboard — mas só depois
> de confirmar que nada client-side usa a anon key.

---

## 2. Railway (backend `server/`)

O repo já traz **`server/railway.json`** (build/start/health como config-as-code).
Passos no dashboard do Railway:

1. **New Project → Deploy from GitHub repo** → selecione `dornelasz/priceiq-app`.
2. Em **Settings → Source**: **Root Directory = `server`**.
   (O Railway lê `server/railway.json` automaticamente.)
3. Confirme os comandos (vêm do `railway.json`):
   - Build: `npm install --include=dev && npm run build`
   - Start: `npm run db:migrate && npm run start`
   - Healthcheck: `/api/health`
4. **Variables** (Settings → Variables):

   Obrigatórias:
   - `NODE_ENV=production`
   - `DATABASE_URL=<string do Supabase, item 1>`
   - `CATALOG_SEARCH_ENABLED=true`
   - `FRONTEND_URL=<URL da Vercel>` (ver item 3)

   Firecrawl:
   - `FIRECRAWL_ENABLED=true`
   - `FIRECRAWL_API_KEY=<sua chave fc-...>`
   - `FIRECRAWL_API_URL=https://api.firecrawl.dev/v2`
   - `FETCH_PROVIDER_PRIORITY=firecrawl,native`

   Opcionais:
   - `CORS_ORIGIN=<URL da Vercel>` (tem precedência sobre FRONTEND_URL)
   - `REDIS_URL=<se houver>`
   - `FIRECRAWL_TIMEOUT_MS=60000`
   - `FIRECRAWL_MAX_PAGES_PER_SEARCH=5`
   - `FIRECRAWL_MAX_CREDITS_PER_SEARCH=10`

   > Não defina `PORT` — o Railway injeta a porta e o server já escuta em
   > `0.0.0.0:$PORT`.

5. Deploy. Acompanhe **Build/Deploy Logs**.
6. Pegue a URL pública (**Settings → Networking → Generate Domain**):
   `https://<servico>.up.railway.app`.
7. Valide: `GET https://<servico>.up.railway.app/api/health` → `{ "ok": true, ... }`.

---

## 3. Vercel (frontend `web/`)

Projeto **priceiq-app** já existe e tem deploy de produção
(`priceiq-app-one.vercel.app`). Falta apontar para o backend:

1. **Settings → Environment Variables**:
   - `NEXT_PUBLIC_API_URL=https://<servico>.up.railway.app` (sem barra final).
2. **Redeploy** (Deployments → ⋯ → Redeploy) para a env var entrar no bundle.
3. Confirme que o SaaS abre e que **não** aparece UI legada (captura assistida /
   colar texto / colar link / busca manual). Já confirmado: essa UI não existe
   no `web/src`.

---

## 4. Fechar o ciclo CORS

Depois que a Vercel tiver a URL final, volte ao Railway e garanta:
- `FRONTEND_URL=https://priceiq-app-one.vercel.app` (ou domínio custom)
- `CORS_ORIGIN=https://priceiq-app-one.vercel.app` (se usar múltiplas origens, CSV)

O server rejeita `localhost` em produção, então use a URL real da Vercel.

---

## 5. Testes do backend real (após /api/health = ok)

Substitua `<API>` pela URL do Railway e `<ID>` pelo id do fornecedor.

```bash
# Criar fornecedor (Kabum)
curl -X POST <API>/api/suppliers -H 'Content-Type: application/json' -d '{
  "name":"Kabum","site":"https://www.kabum.com.br","country":"Brasil",
  "currency":"BRL","type":"Nacional",
  "search_url_template":"https://www.kabum.com.br/busca?query={q}"
}'

curl <API>/api/suppliers

# Discovery (usa Firecrawl se habilitado)
curl -X POST <API>/api/suppliers/<ID>/discover-catalog -H 'Content-Type: application/json' -d '{
  "query":"ssd 1tb nvme",
  "sources":["firecrawl_search","firecrawl_map","sitemap","search_page"],
  "maxCandidates":10
}'

# Processing
curl -X POST <API>/api/suppliers/<ID>/process-catalog -H 'Content-Type: application/json' -d '{
  "query":"ssd 1tb nvme","maxCandidates":3,"minMatchScore":70
}'

# Catalog-first search
curl -X POST <API>/api/suppliers/<ID>/catalog-search -H 'Content-Type: application/json' -d '{
  "query":"ssd 1tb nvme","maxReusableMatches":5,
  "maxDiscoveryCandidates":10,"maxProcessingCandidates":3,"minMatchScore":70
}'
```

Verifique nas respostas: `candidatesFound/Saved`, `sourceBreakdown`, `attempts`
(provider usado), `strategy`, `usefulResults`, `failures`. Confirme em SQL que
`supplier_product_candidates`/`supplier_product_matches` ganharam linhas.
Pare se aparecer `no_credits`/`rate_limited` (billing/limite do Firecrawl).

---

## 6. GitHub Actions / APK

Quando a URL da Vercel estiver validada, configure o secret/var no GitHub:
`PRICEIQ_FRONTEND_URL=https://priceiq-app-one.vercel.app`. Não gerar APK até
backend + frontend estarem validados em produção.

---

## Garantias preservadas

- Cotação só via Investing.com (`currencyService`/`routes/rates` intactos).
- Frete desconhecido nunca vira 0; `total_brl` null sem frete; `price_brl`
  preenchido quando há preço+moeda.
- Sem Gemini/IA/Playwright/Puppeteer/Jina/Diffbot.
- Nenhum secret no repositório.
