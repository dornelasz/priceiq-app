# Deploy do APK PriceIQ — Guia operacional

Este documento descreve como colocar o PriceIQ em produção como APK Android
que abre a versão web real do app (Next.js + Fastify + Postgres), substituindo
o empacotamento do `index.html` legado pela "Opção A" do plano.

> **Estado atual do repo:** o motor de busca V2 (Fases A–E) está pronto e
> testado no backend. Falta apenas plumbar deploy + APK wrapper.
>
> **Importante:** este guia é executado MANUALMENTE pelo dono do projeto.
> Nenhum secret deste documento entra no repo.

---

## Arquitetura final

```
┌──────────────────────────────────┐
│   APK Android (Capacitor)        │
│   capacitor.config.json.server.url:│
│   https://priceiq.vercel.app     │
└──────────────────┬───────────────┘
                   │ WebView HTTPS
                   ▼
┌──────────────────────────────────┐
│   Vercel — web/ (Next.js 14)     │
│   NEXT_PUBLIC_API_URL=<Render>   │
└──────────────────┬───────────────┘
                   │ fetch /api/* (rewrite Next.js → Render)
                   ▼
┌──────────────────────────────────┐
│   Render — server/ (Fastify + V2)│
│   DATABASE_URL → Neon Postgres   │
│   REDIS_URL: vazio (fallback mem)│
│   FRONTEND_URL=<Vercel>          │
└──────────────────┬───────────────┘
                   │ pg
                   ▼
┌──────────────────────────────────┐
│   Neon — Postgres 16 (free)      │
│   migrations 0001..0004          │
└──────────────────────────────────┘
```

- O APK **não empacota `legacy/index.html` (legado)**. Empacota apenas um
  shell mínimo de "Carregando…" que é mostrado se a Internet falhar antes da
  Vercel responder.
- O `legacy/index.html` **continua no repo** apenas como referência
  histórica (não é deployado em lugar nenhum).
- O `index.html` na **raiz** é uma página de aviso de deprecação (para o
  caso de alguém acessar `https://dornelasz.github.io/priceiq-app`).

---

## Checklist — criar contas pelo celular

> Tudo abaixo dá para fazer pelo browser do celular. Para alguns logins
> tem app oficial que facilita.

### Passo 1 — Neon (Postgres)

1. Acesse <https://neon.tech> → "Sign up" (com sua conta GitHub).
2. Crie projeto: **Project name**: `priceiq`. Postgres version: 16. Region:
   escolha "AWS / São Paulo (sa-east-1)" se disponível, senão "AWS / US East".
3. Em "Connection Details", clique no DATABASE_URL e copie o valor inteiro.
   Vai começar com `postgresql://` e ter `?sslmode=require` no final.
4. **Anote** esse valor — vai virar a env `DATABASE_URL` no Render.

### Passo 2 — Render (backend `server/`)

1. Acesse <https://render.com> → "Get Started for Free" (com sua conta GitHub).
2. Autorize o Render a ler o repo `dornelasz/priceiq-app`.
3. Dashboard → "New +" → "Web Service".
4. Conecte o repo `dornelasz/priceiq-app`. Branch: `main`.
5. Preencha:
   - **Name**: `priceiq-server`
   - **Region**: Oregon (US West) — free tier
   - **Branch**: `main`
   - **Root Directory**: `server`
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run db:migrate && npm run start`
   - **Instance Type**: Free
6. Em "Environment Variables", adicione:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | *(cole o valor do Neon, com `?sslmode=require`)* |
   | `FRONTEND_URL` | `https://priceiq.vercel.app` *(provisório — confirma no passo 3)* |

   **NÃO** preencha `REDIS_URL` (cache cai para memória sozinho).
   **NÃO** preencha `PORT` (Render injeta automaticamente).

7. Clique em "Create Web Service". Aguarde ~3 min.
8. Quando o status virar "Live", **anote a URL** do tipo
   `https://priceiq-server.onrender.com`. Essa vira a env `NEXT_PUBLIC_API_URL`
   na Vercel.

### Passo 3 — Vercel (frontend `web/`)

1. Acesse <https://vercel.com/new> → "Continue with GitHub".
2. Autorize a Vercel a ler o repo `dornelasz/priceiq-app`.
3. Clique em "Import" no repo `priceiq-app`.
4. Preencha:
   - **Project Name**: `priceiq`
   - **Framework Preset**: Next.js *(auto-detectado)*
   - **Root Directory**: `web` *(clique em "Edit" e mude)*
   - **Build Command**: deixa o default (`next build`)
5. Em "Environment Variables", adicione:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | *(URL do Render do passo 2, ex: `https://priceiq-server.onrender.com`)* |

6. Clique em "Deploy". Aguarde ~2 min.
7. Quando deploy ficar verde, **anote a URL** do tipo
   `https://priceiq.vercel.app` (ou variação se já existir um projeto Vercel
   com esse nome — pode ser `priceiq-<random>.vercel.app`).

### Passo 4 — Corrigir CORS no Render

1. Volte ao Dashboard Render → `priceiq-server` → Environment.
2. Atualize `FRONTEND_URL` para a URL EXATA da Vercel que acabou de anotar
   no passo 3 (sem barra no final).
3. Clique em "Save Changes". O Render faz redeploy automático (~1 min).

### Passo 5 — Testar no navegador (ANTES do APK)

1. Abra `https://priceiq.vercel.app` (URL real) no navegador do celular.
2. Confirme que a tela inicial é a **versão nova** (sem "CAPTURA ASSISTIDA",
   "Buscar no site", "Colar texto" etc).
3. Crie uma busca. Os fornecedores vão responder com:
   - `validated` se o V2 conseguir extrair via JSON-LD/meta tags.
   - `error` com mensagem `needs_supplier_setup: ...` se o supplier ainda
     não foi configurado (ML/Amazon/Shopee/Magalu/AliExpress estão como
     `unconfigured` desde a Fase B — Fase G fará Guided Setup).
4. Verifique logs do Render → "Logs" para confirmar:
   ```
   [worker] <Fornecedor> | route: recipe | status: <status> | elapsed: ...ms
   ```
   Esse log é a prova de que a Fase E está em ação.

### Passo 6 — Configurar `PRICEIQ_FRONTEND_URL` no GitHub (uma vez)

> **Importante:** o `capacitor.config.json` no repo tem o token
> `__PRICEIQ_FRONTEND_URL__` em vez de uma URL hardcoded. O workflow
> substitui esse token pela URL real **em build-time**, lida da
> Variable/Secret do repo. Isso evita commitar URLs reais.

1. Abra o repo no GitHub → **Settings** → **Secrets and variables** →
   **Actions** → aba **Variables** → **New repository variable**.
2. Name: `PRICEIQ_FRONTEND_URL`
3. Value: a URL real da Vercel (ex: `https://priceiq.vercel.app`),
   **sem barra no final**.
4. Salve.

> Pode usar **Secret** em vez de **Variable** — o workflow lê ambos. Use
> Secret se preferir esconder a URL nos logs públicos.
>
> Para sobrescrever apenas em uma execução (ex: testar branch alternativa),
> use o campo `frontend_url` ao clicar em "Run workflow".

Se você esquecer este passo, o workflow falha logo no primeiro step com:

```
::error::PRICEIQ_FRONTEND_URL não está configurada.
::error::Configure como Variable ou Secret do repo, ou passe pelo workflow_dispatch.
```

### Passo 7 — Gerar o APK

Pelo celular:

1. Abra o GitHub app → repo → "Actions" (ícone Play).
2. Selecione "Build Android APK".
3. Toque em "Run workflow" → branch `main` → "Run workflow".
4. Aguarde ~4–7 min.
5. Quando o workflow ficar verde, role até a seção "Artifacts" e baixe
   `PriceIQ-debug-apk` (vem como `.zip`). Extraia para obter `app-debug.apk`.
6. Abra `app-debug.apk` no celular → autorize "Instalar de fontes
   desconhecidas" se aparecer → instale.
7. Abra o app — agora ele exibe a UI Vercel real. Sem captura assistida.

---

## Variáveis que você precisa copiar/colar

Resumo único:

| Onde | Var | Valor (anote conforme for criando) |
|---|---|---|
| Neon | (só lê) | DATABASE_URL gerada automaticamente |
| Render | `NODE_ENV` | `production` |
| Render | `DATABASE_URL` | *(cola do Neon)* |
| Render | `FRONTEND_URL` | *(URL da Vercel, atualizar depois do passo 3)* |
| Vercel | `NEXT_PUBLIC_API_URL` | *(URL do Render do passo 2)* |
| GitHub repo | Variable/Secret `PRICEIQ_FRONTEND_URL` | *(URL da Vercel — não commita no repo)* |

---

## Como gerar o APK depois (operação recorrente)

- **Mudou só código do `web/`**: Vercel faz auto-deploy do `main`. APK não
  precisa ser regerado (carrega URL remota dinamicamente).
- **Mudou só código do `server/`**: Render faz auto-deploy do `main`. APK
  também não precisa ser regerado.
- **Mudou `capacitor.config.json` ou `build-apk.yml`**: regere o APK pelo
  GitHub Actions (passo 7).

---

## O que NÃO mudou

- `index.html` legado da raiz: continua no repo (referência histórica).
- Cotação (`currencyService.ts`, `routes/rates.ts`, `RateBar.tsx`,
  `settings/page.tsx`): 100% intocada.
- Motor V2 (Fases A–E): intacto.
- `priceSearchWorker.ts`: intacto (Fase E).
- `server/scrapers/*`: intactos.
- Sem Fase F nesta etapa.

---

## Troubleshooting rápido

- **APK abre mas mostra "Carregando…" eterno**: confirma que
  `PRICEIQ_FRONTEND_URL` foi configurada no GitHub (Settings → Actions →
  Variables) e que aponta para uma URL Vercel real.
- **APK abre mas mostra "CAPTURA ASSISTIDA" / "Colar texto" / "Manual"**:
  sua `PRICEIQ_FRONTEND_URL` está apontando para o GitHub Pages do legado
  (https://dornelasz.github.io/priceiq-app) em vez do Vercel SaaS. Troque
  para a URL do Vercel.
- **APK abre Vercel mas busca dá erro 500**: verifica logs do Render
  → provavelmente `DATABASE_URL` ou `FRONTEND_URL` errados.
- **Busca dá CORS error no console do browser**: `FRONTEND_URL` no Render
  precisa ser EXATAMENTE a URL da Vercel (sem barra no final).
- **Render free dormiu (1ª busca demora 30s)**: comportamento esperado
  do free tier. Upgrade `Starter` (~$7/mês) sempre acordado.
- **Neon pausou (1ª query demora 5s)**: idem free tier. Aceita reativação
  automática.

---

## Próximas fases (FORA do escopo deste documento)

- **Fase F**: adicionar coluna `freight_state` em `search_results` + UI
  "Frete a confirmar".
- **Fase G**: Guided Setup para fornecedores que não autoConfig sozinhos
  (rotas `POST /api/suppliers/:id/guided-setup/start` e `/save`,
  tela em `web/src/app/suppliers/`).
- **Limpeza definitiva**: remover `server/scrapers/*` legados e
  `index.html` legado após APK V2 estável em produção.
