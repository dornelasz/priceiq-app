# PriceIQ

> Comparador de preços com cotação ao vivo automática e busca por fornecedores

## Estado atual

PriceIQ está em transição de **app single-file** para **SaaS web completo**. As duas versões coexistem.

### Versão legada (ainda online)
- **`index.html`** — app standalone (HTML/CSS/JS), deployado em GitHub Pages
- **URL:** https://dornelasz.github.io/priceiq-app
- **Função:** referência visual e backup. NÃO é o alvo da migração SaaS.

### Versão SaaS
- **`server/`** — backend Fastify + Postgres + Redis (cotação, busca, suppliers, histórico)
- **`web/`** — frontend Next.js 14 (App Router) com visual idêntico ao legado
- **`docker-compose.yml`** — Postgres 16 + Redis 7 para dev

## Estrutura

```
priceiq-app/
├── index.html              App legado em produção (referência visual)
├── web/                    ✨ Frontend Next.js 14
│   └── src/{app,components,lib}/
├── server/                 ✨ Backend Fastify + Postgres + Redis
│   └── {routes,services,scrapers,workers,db,lib}/
├── infra/                  Configs de infraestrutura
├── docs/                   Documentação de arquitetura
├── docker-compose.yml      Postgres + Redis para dev
└── package.json
```

## Como rodar (cloud / dev local com Docker)

> ℹ️ Não precisa rodar nada no celular. As etapas seguintes assumem ambiente cloud (Codespaces, Render, etc.) ou máquina com Docker.

```bash
# 1. Subir Postgres + Redis
docker compose up -d

# 2. Backend
cd server
cp .env.example .env       # ajustar variáveis necessárias
npm install
npm run db:seed            # aplica schema + insere 7 fornecedores padrão
npm run dev                # http://localhost:3001

# 3. Frontend (em outro terminal)
cd ../web
cp .env.example .env
npm install
npm run dev                # http://localhost:3000
```

## Como testar pelo deploy

### Vercel (frontend) + Render (backend) — recomendado
1. **Render**: provisione Postgres + Redis + Web Service apontando para `server/`.
2. **Vercel**: importar repo, root = `web/`, env `NEXT_PUBLIC_API_URL = https://<sua-api>.onrender.com`.
3. Acessar a URL do Vercel — visual idêntico ao `index.html`, mas dados vêm do backend.

## Cotação automática

A cotação não usa Gemini nem qualquer IA.

Ordem atual:

1. **AwesomeAPI** como fonte principal para `USD-BRL`, `EUR-BRL` e `CNY-BRL`.
2. **Investing.com** como fallback por moeda, se a fonte principal falhar.
3. **Cache/histórico** apenas como fallback quando a atualização automática não conseguir retornar a moeda.

Isso corrige o caso em que o USD ficava preso em valor manual/cacheado: quando a atualização automática funciona, `USD/BRL` volta a ser sobrescrito pela fonte automática.

Variáveis relevantes:

```env
RATES_CACHE_TTL_SECONDS=60
CURRENCY_PRIMARY_SOURCE=awesomeapi
CURRENCY_FALLBACK_SOURCE=investing
CURRENCY_REFRESH_INTERVAL_MS=60000
```

## Roadmap

- [x] **Etapa 1** — Estrutura de pastas + docker-compose + READMEs
- [x] **Etapa 2** — Backend Fastify (rotas + services + scrapers + worker)
- [x] **Etapa 3** — Schema PostgreSQL + migrations + seed + CI
- [x] **Etapa 4** — Frontend Next.js (visual idêntico, consome API)
- [x] **Etapa 5** — Motor de busca com scrapers, anti-produto fantasma e Gemini opcional
- [ ] **Etapa 6** — Cache/uso alto + deploy de produção

## Uso sem dependência de IA

⚠️ **O PriceIQ não depende de Gemini ou qualquer IA para funcionar.**

| Componente | Papel |
|---|---|
| Scrapers específicos (ML/Amazon/Shopee/Magalu/AliExpress) | Motor primário — URL otimizada por marketplace |
| Jina Reader + extração direta (regex) | Pipeline default — sem IA |
| Cache de resultados por fornecedor | Evita buscas repetidas |
| Cotação AwesomeAPI + Investing fallback | Conversão BRL — sem IA |
| Validação de URL (`urlValidator`) | Bloqueia produto fantasma |
| Playwright | Fallback quando Jina é bloqueado (451/403) |
| **Gemini** | **OPCIONAL** — interpretador de texto JÁ coletado, nunca fonte primária |

Por padrão, **`GEMINI_ENABLED=false`**. Se Gemini estiver ligado e a quota acabar, a busca **segue funcionando** com extração direta — uma observação discreta avisa que a IA está indisponível.

Gemini NUNCA:
- pesquisa sozinho
- inventa preço
- bloqueia a busca quando quota acaba
- é necessário para a busca funcionar

## Regras invioláveis

- ❌ **Não redesenhar** a UI — visual de `index.html` é a fonte da verdade
- ❌ **Gemini é opcional e roda apenas no backend** — chave em `server/.env`, nunca no frontend
- ❌ **Não inventar preço** — `urlValidator` + extração direta rejeitam resultados sem evidência
- ❌ **Não usar IA para cotação** — cotação usa AwesomeAPI/Investing/cache
- ❌ **Migração incremental** — cada etapa em PR separado, sem quebrar o legado

## CI

- `.github/workflows/server-ci.yml` — backend: typecheck + build + aplica schema + migrations em Postgres 16 efêmero
- `.github/workflows/web-ci.yml` — frontend: typecheck + lint + build Next.js

## Licença

Propriedade privada.
