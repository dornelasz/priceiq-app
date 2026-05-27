# AI Market Radar

Automação de notícias para acompanhar o mercado de Inteligência Artificial em tempo real.
Coleta conteúdo de **fontes públicas reais** (RSS, blogs oficiais, páginas, papers), faz
**deduplicação**, **resume/classifica com IA (Gemini, opcional)** e gera um **resumo diário** —
tudo com **rastreabilidade total**: fonte, URL e data.

> **Não inventa nada.** A IA só resume/classifica conteúdo realmente coletado. Se uma fonte
> falha, o erro é registrado e as demais continuam. Sem chave Gemini, o sistema funciona e marca
> as notícias como _“pendente de análise”_.

Projeto **independente e autocontido** em `ai-market-radar/` — não depende de nenhum outro
sistema deste repositório.

---

## Stack

- **Next.js 14 (App Router) + TypeScript + Tailwind CSS** — frontend e API (route handlers).
- **PostgreSQL + Prisma** — banco e migrations.
- **Worker Node (node-cron)** — coleta automática em intervalos configuráveis.
- **Gemini API via REST** — análise opcional, configurada **somente por variável de ambiente**.
- **Coletores**: RSS, página pública (Cheerio) e arXiv (RSS/Atom). GitHub fica como estrutura
  preparada (sem coletor quebrado).
- **Vitest** — testes unitários (sem necessidade de banco).
- **Docker Compose** — Postgres + app + worker + migrate.

## O que foi criado (resumo)

- **Dashboard** com principais notícias do dia, “Mais importantes”, “Tendências em alta”,
  “Empresas mais citadas”, “Novas ferramentas”, filtros por categoria, busca, indicador de última
  coleta e botão **Coletar agora**.
- **Notícias** (`/articles`) com filtros (categoria, relevância, fonte, tipo, datas) + busca, e
  **detalhe** (`/articles/[id]`) com resumo da IA, impacto, empresas/tecnologias e trecho original.
- **Fontes** (`/sources`): CRUD, ativar/desativar, coletar agora, status da última coleta e erro.
- **Alertas** (`/alerts`): por palavra-chave, empresa, categoria e relevância mínima, mostrando as
  notícias que bateram (estrutura pronta para e-mail no futuro).
- **Resumo Diário** (`/digest`): Top 5, tendências, empresas, ferramentas e impactos — só do dia.
- **Configurações** (`/settings`): status da Gemini, botão **Testar Gemini API**, crons e métricas.
- **Pipeline**: coletor → URL canônica + hash + score local → dedup → persistência → análise IA.
- **Testes** para normalização de URL, dedup, parsing RSS, criação de notícia, análise sem Gemini,
  isolamento de falha de fonte e geração do resumo diário.

### Arquivos principais

```
ai-market-radar/
├─ prisma/
│  ├─ schema.prisma            # User, Source, Article, ArticleAnalysis, Alert, DailyDigest, FetchLog
│  ├─ migrations/0_init/        # migration SQL inicial
│  └─ seed.ts                   # fontes públicas + alertas de exemplo (sem notícias falsas)
├─ src/
│  ├─ app/                      # páginas (dashboard, articles, sources, alerts, digest, settings)
│  │  └─ api/                   # route handlers (articles, sources, fetch, alerts, digest, settings)
│  ├─ components/               # UI (Shell, cards, formulários, botões client)
│  ├─ lib/
│  │  ├─ collectors/            # rss.ts, webpage.ts, arxiv.ts, index.ts (dispatch por tipo)
│  │  ├─ ai/                    # gemini.ts, prompt.ts (anti-invenção), analyze.ts
│  │  ├─ services/              # fetchRunner.ts, digestService.ts, alertService.ts
│  │  ├─ url.ts                 # canonicalização + hash + similaridade de título
│  │  ├─ dedup.ts / ingest.ts   # deduplicação e plano de ingestão (puros, testáveis)
│  │  ├─ relevance.ts           # score local por palavras-chave
│  │  └─ digest.ts / alerts.ts  # lógica pura do resumo e dos alertas
│  └─ worker/                   # index.ts (cron) e runOnce.ts (coleta única CLI)
├─ tests/                       # vitest (7 arquivos, sem banco)
├─ docker-compose.yml / Dockerfile
└─ .env.example
```

---

## Como rodar localmente

### Opção A — Docker (mais simples)

```bash
cd ai-market-radar
# (opcional) export GEMINI_API_KEY=...   # sem isso, funciona sem IA
docker compose up -d --build              # Postgres + migrate + app + worker
docker compose run --rm app npm run db:seed   # cadastra fontes/alertas iniciais
```

App em **http://localhost:3000**. O worker já começa a coletar.

### Opção B — Local (Node 20+)

```bash
cd ai-market-radar
cp .env.example .env          # ajuste DATABASE_URL e (opcional) GEMINI_API_KEY
npm install

# suba um Postgres (ex.: via Docker)
docker run -d --name radar-pg -p 5432:5432 \
  -e POSTGRES_USER=radar -e POSTGRES_PASSWORD=radar -e POSTGRES_DB=radar postgres:16-alpine

npm run prisma:migrate        # cria o schema
npm run db:seed               # cadastra fontes públicas + alertas de exemplo
npm run fetch:once            # coleta uma vez (requer acesso à internet)

# em dois terminais:
npm run dev                   # app em http://localhost:3000
npm run worker                # coleta automática (cron)
```

## Configurar o `.env`

Copie `.env.example` para `.env`. Principais variáveis:

| Variável | Descrição | Padrão |
|---|---|---|
| `DATABASE_URL` | conexão Postgres (Prisma) | `postgresql://radar:radar@localhost:5432/radar?schema=public` |
| `GEMINI_API_KEY` | **opcional**; sem ela, notícias ficam “pendente de análise” | _vazio_ |
| `GEMINI_MODEL` | modelo Gemini (configurável, nunca hardcoded) | `gemini-2.0-flash` |
| `WORKER_FETCH_CRON` | cron do ciclo de coleta | `*/15 * * * *` |
| `WORKER_DIGEST_CRON` | cron do resumo diário | `0 6 * * *` |
| `ANALYZE_ON_FETCH` | rodar IA logo após coletar | `true` |
| `MAX_ANALYZE_PER_RUN` | limite de análises por ciclo | `20` |
| `DEFAULT_FETCH_INTERVAL_MINUTES` | intervalo padrão de novas fontes | `60` |
| `HTTP_USER_AGENT` | User-Agent transparente da coleta | `AIMarketRadar/1.0` |

> A chave de IA **nunca** fica no código — é lida apenas do ambiente.

## Migrations

```bash
npm run prisma:migrate    # desenvolvimento (cria/aplica migration)
npm run prisma:deploy     # produção (aplica migrations já existentes)
npm run prisma:generate   # regenera o Prisma Client
```

## App e worker

```bash
npm run dev        # app (Next) em modo desenvolvimento
npm run build && npm run start   # produção
npm run worker     # worker de coleta (cron) — processo separado
npm run fetch:once # uma coleta imediata de todas as fontes ativas (CLI)
```

## Testar a Gemini API

1. Defina `GEMINI_API_KEY` no `.env` (obtenha em https://aistudio.google.com/apikey).
2. Abra **/settings** e clique em **Testar Gemini API** — ou:

```bash
curl -X POST http://localhost:3000/api/settings/test-ai
```

Sem a chave, o teste informa que a IA está desligada (e o app continua funcionando).

## Cadastrar nova fonte

- **UI**: página **/sources** → preencha nome, URL (feed RSS ou página pública), tipo, categoria e
  intervalo → **Adicionar fonte**. Use **Coletar** para testar na hora.
- **API**:

```bash
curl -X POST http://localhost:3000/api/sources \
  -H 'Content-Type: application/json' \
  -d '{"name":"Exemplo","url":"https://exemplo.com/feed.xml","type":"RSS","category":"Modelos de IA"}'
```

> Antes de ativar, confirme se a URL tem RSS/feed público. Fontes sem feed confirmado já vêm
> cadastradas como **inativas** no seed (ex.: Anthropic, Meta AI, Product Hunt, GitHub Trending).

## Testes

```bash
npm test           # roda todos (vitest, sem banco)
npm run test:watch
```

---

## Limitações atuais (V1)

- **Autenticação** não implementada (modelo `User` e `Alert.userId` já preparados). Os alertas usam
  um usuário “Demo” no seed.
- **Alertas** ainda não enviam e-mail/push — apenas exibem correspondências na aba **Alertas**
  (estrutura pronta para notificações futuras).
- **Coletor de página** trata a página como um único item (bom para páginas simples, não para
  listas/índices). **GitHub Trending** não tem feed oficial → coletor não implementado (estrutura
  preparada; cadastre `releases.atom` de repositórios, se quiser).
- **URLs de feed do seed** são públicas e conhecidas, mas podem mudar; se uma falhar, o erro é
  registrado na fonte (sem dados falsos). Confirme/ative conforme necessário.
- A coleta depende de **acesso à internet** do processo (worker/app).
- Sem agressividade: respeita robots/Termos; **não** burla paywall, captcha, login ou bloqueios.

## Próximos passos recomendados

1. Autenticação (NextAuth/Lucia) e alertas por usuário.
2. Notificações reais (e-mail/Slack) a partir da estrutura de alertas.
3. Reprocessar pendentes em lote e reanálise sob demanda com fila (BullMQ/Redis).
4. Coletor de página por-item (sitemaps/listagens) e coletor GitHub via `releases.atom`.
5. Embeddings para dedup semântica e agrupamento de notícias por evento.
6. Cache/ETag e backoff por fonte; métricas e observabilidade do worker.
7. Testes de integração com um Postgres efêmero (Testcontainers).
