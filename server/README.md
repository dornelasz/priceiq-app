# PriceIQ — Backend (Etapa 2)

Backend Node.js + TypeScript com **Fastify**, **Postgres** e **Redis**.

## 🚀 Como rodar (cloud/local com Docker)

> ℹ️ Não precisa rodar no celular. Esta seção é para ambiente de dev cloud (Codespaces, Render, etc.) ou máquina local com Docker.

```bash
# 1. Subir Postgres + Redis (na raiz do projeto)
docker compose up -d

# 2. Instalar deps do server
cd server
cp .env.example .env   # ajustar GEMINI_API_KEY
npm install

# 3. Aplicar schema + seed de fornecedores padrão
npm run db:seed

# 4. Subir o server em dev (hot reload)
npm run dev
```

Servidor sobe em `http://localhost:3001`.

## 📂 Estrutura

```
server/
├── index.ts                  ← Fastify entry, registra plugins e rotas
├── config.ts                 ← .env validado por Zod
├── routes/
│   ├── suppliers.ts          ← GET/POST/PUT/DELETE /api/suppliers
│   ├── searches.ts           ← POST/GET /api/searches
│   ├── results.ts            ← GET /api/searches/:id/results
│   └── rates.ts              ← GET /api/rates, POST /api/rates/refresh
├── services/
│   ├── searchService.ts      ← Orquestração de buscas + persistência
│   ├── rankingService.ts     ← Ordena resultados por melhor valor
│   ├── currencyService.ts    ← Cotação Investing.com (algoritmo portado do frontend)
│   ├── cacheService.ts       ← Redis com fallback em memória
│   └── supplierService.ts    ← CRUD de fornecedores
├── scrapers/
│   ├── jinaReaderScraper.ts  ← Jina Reader + Gemini (implementação principal)
│   └── genericPlaywrightScraper.ts  ← Stub para Playwright (Etapa 4)
├── workers/
│   └── priceSearchWorker.ts  ← Worker in-process, paralelo, com timeout/retry
├── db/
│   ├── schema.sql            ← DDL idempotente
│   ├── pool.ts               ← pg Pool
│   └── seed.ts               ← Schema + fornecedores padrão
└── lib/
    ├── errors.ts             ← Erros tipados
    ├── validators.ts         ← Schemas Zod
    └── gemini.ts             ← Cliente Gemini (somente backend)
```

## 🔌 Rotas

### Fornecedores
| Método | Rota | Descrição |
|---|---|---|
| `GET`    | `/api/suppliers`        | Lista todos os fornecedores (globais + custom) |
| `POST`   | `/api/suppliers`        | Cria fornecedor customizado |
| `PUT`    | `/api/suppliers/:id`    | Atualiza fornecedor |
| `DELETE` | `/api/suppliers/:id`    | Remove fornecedor |

### Buscas
| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/searches`            | Cria busca + dispara worker. Retorna `202` com `{id}`. |
| `GET`  | `/api/searches`            | Lista buscas (paginado: `?limit=20&offset=0`) |
| `GET`  | `/api/searches/:id`        | Status/progresso de uma busca |
| `GET`  | `/api/searches/:id/results`| Resultados detalhados por fornecedor |

### Cotação
| Método | Rota | Descrição |
|---|---|---|
| `GET`  | `/api/rates`         | Cotação atual (cached, TTL `RATES_CACHE_TTL_SECONDS`) |
| `POST` | `/api/rates/refresh` | Força refresh (ignora cache) |

### Health
| `GET` | `/health`     | Saúde básica + estado do Redis |
| `GET` | `/api/health` | Saúde da API |

## 🛡️ Garantias

- **Gemini só no backend.** Chave nunca vai pro frontend.
- **Timeout por fornecedor** (`SUPPLIER_TIMEOUT_MS`, default 30s).
- **Falha isolada.** Se um fornecedor falhar, os outros continuam — erro fica salvo em `search_results.error_message`.
- **Cache Redis com fallback em memória** — se Redis cair, app continua.
- **Cotação Investing intocada** — algoritmo Promise.any + atualização parcial portado do frontend, validado.

## 🧪 Comandos

```bash
npm run dev          # tsx watch (hot reload)
npm run typecheck    # tsc --noEmit
npm run build        # tsc → dist/
npm run start        # node dist/index.js (produção)
npm run db:seed      # aplica schema + insere fornecedores padrão
```

## ⚙️ Variáveis de ambiente

Ver `.env.example`. Resumo:

- `DATABASE_URL` — Postgres
- `REDIS_URL` — Redis (opcional, falha graceful)
- `GEMINI_API_KEY` — chave do Google AI Studio
- `SUPPLIER_TIMEOUT_MS` — limite por fornecedor (default 30000)
- `SEARCH_CONCURRENCY` — fornecedores em paralelo (default 5)
- `RATES_CACHE_TTL_SECONDS` — TTL do cache de cotação (default 60)
