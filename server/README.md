# PriceIQ — Backend

Backend Node.js + TypeScript com **Fastify**, **Postgres** e **Redis**.

## 🔍 Motor de busca (Etapa 5)

Pipeline para cada fornecedor (em paralelo, com timeout individual):

```
POST /api/searches { query, supplierIds?, forceRefresh? }
        │
        ▼ status='running' (em < 50ms)
   ┌────────────────────────────────────────────────────┐
   │ Worker (background) — para cada supplier:          │
   │  ① Cache supplier_result:{id}:{normalized_q}?      │
   │     → hit: reusa (from_cache=true)                 │
   │  ② scraper específico (ML/Amazon/Shopee/Magalu/Ali)│
   │  ③ jinaReaderScraper (genérico)                    │
   │  ④ Playwright (stub — fallback)                    │
   │     • Gemini é interpretador interno (Jina)        │
   │  ⑤ Converte para BRL via Investing.com             │
   │  ⑥ Salva em search_results                         │
   └────────────────────────────────────────────────────┘
        │
        ▼ finalizeStatus()
   completed | partial_failed | failed
```

**REGRA-OURO:** se preço não for encontrado com segurança, salva `error_message`/`warning` para aquele fornecedor — **NUNCA inventa preço**.

### Endpoints da busca

```
POST /api/searches             { query, supplierIds?, forceRefresh? } → 202 { searchId, status }
GET  /api/searches/:id         status + selected_supplier_ids
GET  /api/searches/:id/results { search, progress, results, errors, best }
```

### Cache

- **Chave:** `supplier_result:${supplier_id}:${normalized_query}` (Redis + memória fallback)
- **TTL:** 1 hora
- Resultado cacheado é marcado `from_cache=true` no DB
- `forceRefresh=true` ignora cache

### Match score

`matchingService.score(query, productName)` → 0-100, baseado em:
- Tokens da query presentes no nome (1.0 exato, 0.5 substring)
- Bônus se query é substring exata do nome
- Penalidade se o produto parece acessório quando a query não pediu



## 🗄️ Banco de dados (Etapa 3)

### Tabelas

| Tabela | Função |
|---|---|
| `suppliers` | Fornecedores padrão + customizados (com `extraction_mode` + `extractor_config` JSONB) |
| `searches` | Buscas com `selected_supplier_ids`, `best_supplier`, `best_total_brl` |
| `search_results` | Resultado por fornecedor (preço, total_brl, exchange_rate_used, warning, error_message…) |
| `exchange_rates` | Histórico de cotações Investing.com (currency → BRL) |
| `app_settings` | Key-value JSONB para config da app (NUNCA chaves de API) |
| `_migrations` | Controle de migrações aplicadas |

### Setup do banco (em ambiente cloud / Codespaces / dev local)

```bash
# 1. Subir Postgres + Redis (na raiz do projeto)
docker compose up -d

# 2. Configurar .env
cd server
cp .env.example .env
# Editar GEMINI_API_KEY (DATABASE_URL e REDIS_URL já vêm com os defaults do docker-compose)

# 3. Instalar deps
npm install

# 4. Setup completo (migrações + seed dos 7 fornecedores padrão)
npm run db:seed
```

### Scripts disponíveis

```bash
npm run dev          # tsx watch (hot reload) em http://localhost:3001
npm run build        # tsc → dist/
npm run start        # node dist/index.js (produção)
npm run typecheck    # tsc --noEmit (verificação sem build)

# Banco
npm run db:setup     # Aplica migrações pendentes (idempotente)
npm run db:migrate   # Alias de db:setup
npm run db:seed      # Migrações + seed dos fornecedores padrão
npm run db:reset     # ⚠️ APENAS dev/test — TRUNCATE tudo (preserva schema)
```

### Migrações

```
server/db/
├── schema.sql                  ← Estado atual (idempotente, "snapshot" da estrutura)
└── migrations/
    └── 0001_init.sql           ← Migração inicial
```

**Convenção de nomes:** `NNNN_descricao.sql` (4 dígitos, snake_case)
**Aplicação:** `npm run db:migrate` aplica em ordem alfabética e registra em `_migrations`
**Transacional:** cada migration roda em BEGIN/COMMIT — falha = rollback automático

Para adicionar nova migração:
1. Criar `server/db/migrations/0002_minha_mudanca.sql`
2. Rodar `npm run db:migrate`
3. (Opcional) Atualizar `schema.sql` para refletir o novo estado

### Seed

Insere os **7 fornecedores que já existem no `index.html` original** do PriceIQ:
- Mercado Livre, Amazon BR, Shopee, Magalu (ativos)
- AliExpress (ativo)
- Alibaba, Amazon USA (inativos por padrão)

Idempotente — roda quantas vezes precisar, não duplica.

### Deploy em cloud

Em ambiente cloud (Render, Railway, Fly.io, Heroku, etc.):

1. **Provisione Postgres + Redis** no provider (DATABASE_URL e REDIS_URL via env)
2. **Defina `GEMINI_API_KEY`** nas env vars do serviço (NÃO no banco, NÃO no frontend)
3. **Build:** `cd server && npm install && npm run build`
4. **Migrate + seed:** `npm run db:seed` (executar como `predeploy` ou job manual)
5. **Start:** `npm run start`

Exemplo `render.yaml` (futuro):
```yaml
services:
  - type: web
    name: priceiq-api
    rootDir: server
    buildCommand: npm install && npm run build
    startCommand: npm run db:setup && npm run start
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: priceiq-db, property: connectionString }
      - key: REDIS_URL
        fromService: { name: priceiq-redis, type: redis, property: connectionString }
      - key: GEMINI_API_KEY
        sync: false   # secret, set in dashboard
```

## 🔌 Endpoints

### Health
- `GET /health` — saúde básica + estado do Redis
- `GET /api/health` — saúde da API
- `GET /api/db/health` — estado do banco (migrações aplicadas, pool stats)

### Fornecedores
| Método | Rota | |
|---|---|---|
| `GET`    | `/api/suppliers`        | lista todos |
| `POST`   | `/api/suppliers`        | cria customizado |
| `PUT`    | `/api/suppliers/:id`    | atualiza |
| `DELETE` | `/api/suppliers/:id`    | remove |

### Buscas
| Método | Rota | |
|---|---|---|
| `POST` | `/api/searches`             | dispara busca (retorna 202) |
| `GET`  | `/api/searches`             | lista paginada (`?limit=20&offset=0`) |
| `GET`  | `/api/searches/:id`         | status + progresso |
| `GET`  | `/api/searches/:id/results` | resultados detalhados |

### Cotação
| Método | Rota | |
|---|---|---|
| `GET`  | `/api/rates`         | atual (cached, TTL `RATES_CACHE_TTL_SECONDS`) |
| `POST` | `/api/rates/refresh` | força refresh (ignora cache) |

## 📂 Estrutura

```
server/
├── index.ts                  Fastify entry
├── config.ts                 .env validado por Zod
├── db/
│   ├── schema.sql            Schema idempotente (current state)
│   ├── client.ts             Pool + query helpers (fonte única)
│   ├── pool.ts               Reexport de client.ts (compat)
│   ├── migrator.ts           Aplica migrações em ordem
│   ├── migrate-cli.ts        CLI: npm run db:migrate
│   ├── reset-cli.ts          CLI: npm run db:reset (dev/test)
│   ├── seed.ts               CLI: npm run db:seed
│   └── migrations/
│       └── 0001_init.sql     Schema inicial
├── routes/                   Suppliers, searches, results, rates
├── services/
│   ├── databaseService.ts    setup() / health() / upsertSuppliers() / truncateAll()
│   ├── supplierService.ts    CRUD
│   ├── searchService.ts      Orquestração + worker dispatch
│   ├── currencyService.ts    Investing.com (algoritmo do frontend portado)
│   ├── cacheService.ts       Redis com fallback memória
│   └── rankingService.ts     Ordena por melhor valor
├── scrapers/
│   ├── jinaReaderScraper.ts  Jina Reader + Gemini
│   └── genericPlaywrightScraper.ts  Stub
├── workers/
│   └── priceSearchWorker.ts  Paralelismo + timeout + falha isolada
└── lib/
    ├── errors.ts             Erros tipados
    ├── validators.ts         Zod schemas
    └── gemini.ts             Cliente Gemini (BACKEND ONLY)
```

## 🛡️ Garantias

- **Gemini só no backend.** `lib/gemini.ts` lê `process.env.GEMINI_API_KEY`. Nunca exposto ao cliente.
- **Sem segredo no banco.** Chaves de API ficam em `.env` (12factor).
- **Cache e histórico no banco.** localStorage do frontend será migrado para `searches`/`search_results` (Etapa 4).
- **Timeout por fornecedor** (`SUPPLIER_TIMEOUT_MS`, default 30s).
- **Falha isolada.** Um fornecedor caído NÃO derruba a busca — `error_message` salvo em `search_results`.
- **Migrações idempotentes** + transacionais.
- **Cotação Investing intacta** — algoritmo portado linha-a-linha (Promise.any × 9, parsing data-test, atualização parcial).
