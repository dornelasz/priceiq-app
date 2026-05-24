# PriceIQ

> Comparador de preços com cotação ao vivo da Investing.com

## Estado atual

PriceIQ é um **SaaS web** com backend Fastify e frontend Next.js. O
single-file legado foi aposentado e movido para `legacy/` apenas como
referência histórica.

### Entrada real (produção)
- **`web/`** — frontend Next.js 14 (App Router), hospedado em Vercel.
- **`server/`** — backend Fastify + Postgres, hospedado em Render.
- **APK Android** — wrapper Capacitor que abre `PRICEIQ_FRONTEND_URL` no WebView.

### Versão legada (não é a entrada)
- **`legacy/index.html`** — antigo app standalone com Gemini e captura
  assistida. **Não é mais usado**, mantido só por histórico.
- **`index.html`** na raiz — apenas página de aviso de deprecação para
  quem ainda acessar a URL antiga do GitHub Pages.

> **Detalhes do entrypoint:** veja `docs/deployment-entrypoint.md`.

## Estrutura

```
priceiq-app/
├── index.html              ⚠️ Página de aviso de deprecação (não é o app)
├── legacy/
│   └── index.html          Código legado preservado (não é deployado)
├── web/                    Frontend Next.js 14 — entrada real do SaaS
│   └── src/{app,components,lib}/
├── server/                 Backend Fastify + Postgres + Redis
│   └── {routes,services,suppliers/v2,workers,db,lib}/
├── capacitor.config.json   Token __PRICEIQ_FRONTEND_URL__ — injetado no build
├── .github/workflows/
│   └── build-apk.yml       Valida PRICEIQ_FRONTEND_URL e gera APK
├── docs/
│   ├── architecture.md
│   └── deployment-entrypoint.md
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
3. Acessar a URL do Vercel — UI Next.js do SaaS real (visual herdado do antigo `legacy/index.html`, mas dados vêm do backend).

## Roadmap

- [x] **Etapa 1** — Estrutura de pastas + docker-compose + READMEs
- [x] **Etapa 2** — Backend Fastify (rotas + services + scrapers + worker)
- [x] **Etapa 3** — Schema PostgreSQL + migrations + seed + CI
- [x] **Etapa 4** — Frontend Next.js (visual idêntico, consome API)
- [ ] **Etapa 5** — Auth + multi-tenancy
- [ ] **Etapa 6** — Deploy de produção + billing

## Motor Universal de Busca

O PriceIQ usa **um único motor universal** para pesquisar produtos em qualquer fornecedor. **O usuário não escolhe modo** (Jina, Playwright, IA, etc.) — só cadastra o fornecedor com `{q}` na URL de busca e o motor faz o resto.

**Cadastro mínimo de fornecedor:** nome, site, URL de busca (com `{q}`), moeda, país/tipo, ativo. Sem campos de "modo de extração" no formulário.

**Cadeia interna (cascata automática)** — escondida do usuário:
1. URL otimizada por marketplace conhecido (ML, Amazon, Shopee, Magalu, AliExpress).
2. **fetch direto** do HTML (sites SSR / HTML estático).
3. **Jina Reader** (sites JS-heavy / SPA).
4. **Playwright** (apenas se instalado e os anteriores foram bloqueados).

**Parser universal** (sem IA) — tenta em ordem:
- JSON-LD `schema.org/Product` (`<script type="application/ld+json">`)
- `__NEXT_DATA__` e outros JSON embedded
- Markdown / texto visível com regex de preço + URL + nome

**Critérios de aceitação:**
- Preço precisa ter contexto válido (rejeita avaliação `4.8`, capacidade `128GB`, parcelas `12x`, anos `2024`, etc.).
- Resultado precisa ter `evidence_text` (trecho onde o preço foi encontrado). Sem evidência → rejeitado.
- Match score: **≥75 confiável · 50–74 com warning · <50 rejeitado**.
- Acessórios (capinha, película, cabo, etc.) são rejeitados quando a busca é por produto principal.

**Frete:**
- "Frete grátis" detectado → `freight=0`, warning "Frete grátis confirmado".
- Valor explícito → `freight=X`.
- Não encontrado → `freight=0`, warning "Frete não encontrado; total pode mudar no checkout" e confidence reduzida.

**Validação de link (anti produto fantasma):**
- `link_type="product"` + `link_validated=true` → botão **Ver Produto**.
- `link_type="search"` → botão **Ver busca** (nunca "Ver Produto").
- `link_type="unverified"` ou sem link → botão desabilitado, aviso discreto.
- Padrões reconhecidos: `/MLB`, `/dp/ASIN`, `-i.shopid.itemid`, `/p/`, `/item/`, `/product-detail/`, `/produto/`, `/products/...`.

**Cache:**
- Chave: `supplier_id + normalized_query`. TTL 1h.
- Reaproveita apenas resultados válidos (com preço). Erros nunca são cacheados.
- `forceRefresh=true` ignora cache.

**Erros isolados por fornecedor:** falha em um fornecedor não afeta os outros. Mensagens padronizadas: "Preço não encontrado com segurança", "Link de produto não validado", "Fornecedor bloqueou leitura", "Produto encontrado parece ser acessório", "Página não retornou conteúdo suficiente", "Timeout no fornecedor".

**Gemini é opcional** (`GEMINI_ENABLED=false` por padrão). Quando ligado, atua apenas como interpretador de texto já coletado — nunca pesquisa, nunca inventa preço, nunca bloqueia a busca. Sem chave/quota → busca segue normal.

## Frontend principal

- **Entrada real:** `web/` (Next.js 14, App Router). Único frontend em produção.
- **Legado:** `legacy/index.html` — preservado só por histórico, não é deployado nem empacotado no APK. A raiz tem um `index.html` mínimo de aviso de deprecação.

## Backend principal

- **`server/`** — Fastify + Postgres + Redis. Expõe `/api/searches`, `/api/searches/:id/results`, `/api/suppliers`, `/api/rates`.

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
- ❌ **Não redesenhar** a UI — visual de `legacy/index.html` é a fonte da verdade visual (mas o app em produção é `web/`)
- ❌ **Gemini é opcional e roda apenas no backend** — chave em `server/.env`, nunca no frontend
- ❌ **Não inventar preço** — `urlValidator` + extração direta rejeitam resultados sem evidência
- ❌ **Migração incremental** — cada etapa em PR separado, sem quebrar o legado

## CI

- `.github/workflows/server-ci.yml` — backend: typecheck + build + aplica schema + migrations em Postgres 16 efêmero
- `.github/workflows/web-ci.yml` — frontend: typecheck + lint + build Next.js

## Licença

Propriedade privada.
