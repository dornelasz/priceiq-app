# PriceIQ

> Comparador de preços com cotação ao vivo da Investing.com

## Estado atual

PriceIQ está em transição de **app single-file** para **SaaS web completo**. As duas versões coexistem.

### Versão legada (ainda online)
- **`index.html`** — app standalone (HTML/CSS/JS), deployado em GitHub Pages
- **URL:** https://dornelasz.github.io/priceiq-app
- **Função:** referência visual e backup. NÃO é o alvo da migração SaaS.

### Versão SaaS (Etapas 1-4 concluídas)
- **`server/`** — backend Fastify + Postgres + Redis (cotação, busca, suppliers, histórico)
- **`web/`** — frontend Next.js 14 (App Router) com visual idêntico ao legado
- **`docker-compose.yml`** — Postgres 16 + Redis 7 para dev

## Estrutura

```
priceiq-app/
├── index.html              App legado em produção (referência visual)
├── web/                    ✨ Frontend Next.js 14 (Etapa 4)
│   └── src/{app,components,lib}/
├── server/                 ✨ Backend Fastify + Postgres + Redis (Etapas 2-3)
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
cp .env.example .env       # ajustar GEMINI_API_KEY
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
1. **Render**: provisione Postgres + Redis + Web Service apontando para `server/`. Definir `GEMINI_API_KEY`.
2. **Vercel**: importar repo, root = `web/`, env `NEXT_PUBLIC_API_URL = https://<sua-api>.onrender.com`
3. Acessar a URL do Vercel — visual idêntico ao `index.html`, mas dados vêm do backend.

## Roadmap

- [x] **Etapa 1** — Estrutura de pastas + docker-compose + READMEs
- [x] **Etapa 2** — Backend Fastify (rotas + services + scrapers + worker)
- [x] **Etapa 3** — Schema PostgreSQL + migrations + seed + CI
- [x] **Etapa 4** — Frontend Next.js (visual idêntico, consome API)
- [ ] **Etapa 5** — Auth + multi-tenancy
- [ ] **Etapa 6** — Deploy de produção + billing

## Uso sem dependência de IA

⚠️ **O PriceIQ não depende de Gemini ou qualquer IA para funcionar.**

| Componente | Papel |
|---|---|
| Scrapers específicos (ML/Amazon/Shopee/Magalu/AliExpress) | Motor primário — URL otimizada por marketplace |
| Jina Reader + extração direta (regex) | Pipeline default — sem IA |
| Cache de resultados por fornecedor | Evita buscas repetidas |
| Cotação Investing.com (Promise.any × 30 tentativas, fonte única) | Conversão BRL — sem IA |
| Validação de URL (`urlValidator`) | Bloqueia produto fantasma |
| Playwright | Fallback quando Jina é bloqueado (451/403) |
| **Gemini** | **OPCIONAL** — interpretador de texto JÁ coletado, nunca fonte primária |

Por padrão, **`GEMINI_ENABLED=false`**. Se Gemini estiver ligado e a quota acabar, a busca **segue funcionando** com extração direta — uma observação discreta avisa que a IA está indisponível.

## Cotação automática

- A cotação usa **somente Investing.com** (USD/BRL, EUR/BRL, CNY/BRL).
- Atualiza a cada **1 minuto** (cache TTL = 60s).
- Cada moeda tem status independente: se USD falhar mas EUR/CNY funcionarem, EUR/CNY atualizam e USD mantém o último valor automático salvo, com aviso discreto.
- O botão **Atualizar cotação agora** força nova busca na Investing (ignora cache).
- **Manual foi removido** — não há mais inputs de cotação manual em nenhuma interface.
- **AwesomeAPI não é usada** — fonte única é Investing.
- **Gemini não é usado para cotação** — IA é apenas interpretador opcional para preços.

Gemini NUNCA:
- pesquisa sozinho
- inventa preço
- bloqueia a busca quando quota acaba
- é necessário para a busca funcionar

## Regras invioláveis

- ❌ **Não alterar** a fonte da cotação — Investing.com é única; não usar AwesomeAPI, IA ou cotação manual
- ❌ **Não redesenhar** a UI — visual de `index.html` é a fonte da verdade
- ❌ **Gemini é opcional e roda apenas no backend** — chave em `server/.env`, nunca no frontend
- ❌ **Não inventar preço** — `urlValidator` + extração direta rejeitam resultados sem evidência
- ❌ **Migração incremental** — cada etapa em PR separado, sem quebrar o legado

## CI

- `.github/workflows/server-ci.yml` — backend: typecheck + build + aplica schema + migrations em Postgres 16 efêmero
- `.github/workflows/web-ci.yml` — frontend: typecheck + lint + build Next.js

## Licença

Propriedade privada.
