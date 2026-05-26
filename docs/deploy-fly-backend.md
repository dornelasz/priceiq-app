# Deploy: Fly.io — backend PriceIQ (server/)

> **Nota:** o alvo de deploy **oficial** é o **Render** — veja
> [`docs/deploy-render-backend.md`](./deploy-render-backend.md). Este guia de
> Fly.io fica como alternativa e não é usado no deploy oficial.

Guia de deploy do backend Fastify no Fly.io. **Nenhum secret fica aqui** —
todos os valores sensíveis são configurados via `fly secrets set`.

Arquitetura após o deploy:

```
Vercel (web/, Next.js)  ──HTTP──>  Fly.io (server/, Fastify)  ──SQL──>  Supabase (Postgres)
                                          │
                                          └── Firecrawl (provider de coleta, opcional)
```

---

## Pré-requisitos

- [Fly CLI instalado](https://fly.io/docs/hands-on/install-flyctl/)
- Conta no Fly.io: `fly auth login`
- `DATABASE_URL` do Supabase (Pooler, porta 6543) em mãos (não commitar)
- (Opcional) `FIRECRAWL_API_KEY`

---

## 1. Preparar os arquivos

```bash
cd server/
cp fly.toml.example fly.toml
# Edite fly.toml: troque "priceiq-server" pelo nome real do app
```

Adicione `server/fly.toml` ao `.gitignore` se o repo for público (o nome do app
expõe o subdomínio `.fly.dev`).

---

## 2. Criar o app no Fly.io (sem deploy)

```bash
fly launch --no-deploy --name priceiq-server --region gru
# Responda "no" para banco Postgres — usamos o Supabase
# O fly.toml será gerado/atualizado; verifique se bate com o .example
```

---

## 3. Configurar secrets

Substitua os valores entre `<…>`. **Nunca** coloque valores reais no repo.

```bash
fly secrets set \
  NODE_ENV=production \
  DATABASE_URL="postgresql://postgres.<ref>:<PASSWORD>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres" \
  FRONTEND_URL="https://priceiq-app-one.vercel.app" \
  CORS_ORIGIN="https://priceiq-app-one.vercel.app" \
  CATALOG_SEARCH_ENABLED=true \
  NODE_OPTIONS="--dns-result-order=ipv4first"
```

Firecrawl (opcional):

```bash
fly secrets set \
  FIRECRAWL_ENABLED=true \
  FIRECRAWL_API_KEY="fc-..." \
  FIRECRAWL_API_URL="https://api.firecrawl.dev/v2" \
  FETCH_PROVIDER_PRIORITY="firecrawl,native"
```

> Não defina `PORT` — o Fly.io injeta a porta e o server já lê `process.env.PORT`.

---

## 4. Deploy

```bash
fly deploy
# Acompanhe os logs: fly logs
```

Build:  `npm install --include=dev && npm run build` (via Dockerfile)
Start:  `node dist/db/migrate-cli.js && node dist/index.js`
Health: `GET /api/health` → `{ "ok": true, ... }`

---

## 5. Verificar

```bash
# URL pública: fly status (campo Hostname)
export API=https://priceiq-server.fly.dev

curl $API/api/health
# → { "ok": true, "timestamp": "...", "env": "production" }

curl $API/api/suppliers
# → { "items": [...] }
```

---

## 6. Variáveis de ambiente — referência completa

| Variável                    | Obrigatória | Valor padrão       | Descrição |
|-----------------------------|:-----------:|--------------------|-----------|
| `NODE_ENV`                  | sim         | —                  | `production` |
| `DATABASE_URL`              | sim         | —                  | Pooler Supabase (porta 6543) |
| `FRONTEND_URL`              | sim         | —                  | URL Vercel sem barra final |
| `CORS_ORIGIN`               | não         | valor de FRONTEND_URL | CSV de origens permitidas |
| `CATALOG_SEARCH_ENABLED`    | não         | `true`             | Habilita busca catalog-first |
| `FIRECRAWL_ENABLED`         | não         | `false`            | Habilita provider Firecrawl |
| `FIRECRAWL_API_KEY`         | se enabled  | —                  | Chave `fc-...` (secret) |
| `FIRECRAWL_API_URL`         | não         | `https://api.firecrawl.dev/v2` | Endpoint Firecrawl |
| `FETCH_PROVIDER_PRIORITY`   | não         | `native`           | `firecrawl,native` |
| `FIRECRAWL_TIMEOUT_MS`      | não         | `60000`            | Timeout por requisição |
| `FIRECRAWL_MAX_PAGES_PER_SEARCH` | não   | `5`                | Páginas por busca |
| `FIRECRAWL_MAX_CREDITS_PER_SEARCH` | não | `10`              | Créditos por busca |
| `REDIS_URL`                 | não         | —                  | Cache Redis (sem → memória) |
| `NODE_OPTIONS`              | não         | —                  | `--dns-result-order=ipv4first` recomendado |
| `PORT`                      | não         | `3001`             | Injetado pelo Fly.io automaticamente |

---

## 7. Fechar o ciclo CORS (pós-deploy)

Depois que o Fly.io tiver a URL final, volte à Vercel e configure:

```
NEXT_PUBLIC_API_URL=https://priceiq-server.fly.dev
```

E confirme que `CORS_ORIGIN` / `FRONTEND_URL` no Fly.io apontam para a URL real
da Vercel — o server rejeita `localhost` em produção.

---

## 8. Smoke test (pós-deploy)

```bash
cd server/
PRICEIQ_API_URL=https://priceiq-server.fly.dev npm run smoke:api -- --safe
# Testa health + GET /api/suppliers sem escrever nada

PRICEIQ_API_URL=https://priceiq-server.fly.dev npm run smoke:api \
  --catalog --supplier-id=<UUID> --query="ssd 1tb nvme"
# Testa catalog read routes (GET, somente leitura)
```

---

## Garantias preservadas

- Cotação só via Investing.com (`currencyService`/`routes/rates`).
- Frete desconhecido nunca vira 0; `total_brl` null sem frete.
- `FIRECRAWL_API_KEY` nunca aparece em logs ou respostas da API.
- Sem Gemini/IA/Playwright/Puppeteer/Jina/Diffbot.
- Nenhum secret no repositório.
