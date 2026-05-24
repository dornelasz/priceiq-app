# Variáveis de ambiente — PriceIQ em produção

Este documento lista todas as variáveis necessárias para conectar o frontend
`web/` ao backend `server/` em produção.

> **Firecrawl e Gemini NÃO fazem parte desta etapa.** Suas variáveis já estão
> documentadas no código (`server/config.ts`) mas não precisam ser configuradas
> para o SaaS funcionar — ambos são opcionais.

---

## Arquitetura de runtime

```
APK Android (Capacitor)
  └─ WebView → PRICEIQ_FRONTEND_URL (Vercel)
                    │
              web/ (Next.js 14 — Vercel)
              NEXT_PUBLIC_API_URL ──────────┐
                                           │ /api/* rewrite (Next.js)
                                           ▼
                                  server/ (Fastify — Render)
                                  FRONTEND_URL / CORS_ORIGIN
                                  DATABASE_URL (Neon Postgres)
```

---

## Frontend — `web/` hospedado na Vercel

| Variável | Obrigatória em prod | Descrição |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Sim** | URL base do backend Fastify sem barra final. Ex: `https://priceiq-server.onrender.com` |

**Consequência se ausente:** chamadas de API no SSR retornam caminho relativo
(`/api/...`) sem host → `fetch` falha → página de resultados quebra. Um aviso
é logado no console do servidor Next.js durante o build.

**Normalização:** o frontend remove barra final automaticamente, então
`https://api.exemplo.com` e `https://api.exemplo.com/` são equivalentes.

---

## Backend — `server/` hospedado no Render

| Variável | Obrigatória em prod | Padrão (dev) | Descrição |
|---|---|---|---|
| `DATABASE_URL` | **Sim** | — | Connection string Postgres. Ex: `postgresql://...?sslmode=require` (Neon) |
| `FRONTEND_URL` | **Sim** | `http://localhost:5173` | URL do frontend para CORS. Ex: `https://priceiq.vercel.app` |
| `CORS_ORIGIN` | Não | `''` | Alternativa ou complemento a `FRONTEND_URL`. Aceita múltiplas origens separadas por vírgula. Se definida, tem precedência sobre `FRONTEND_URL`. |
| `NODE_ENV` | Recomendado | `development` | Use `production` no Render. |
| `PORT` | Não | `3001` | Render injeta automaticamente — não preencher. |
| `REDIS_URL` | Não | `redis://localhost:6379` | Cache Redis. Se ausente ou inacessível, cai para cache em memória. |

**Consequência se `FRONTEND_URL` / `CORS_ORIGIN` ausentes ou localhost em
produção:** o servidor recusa a inicialização com mensagem de erro clara e
`process.exit(1)`.

### Variáveis opcionais (Firecrawl / Gemini — não configurar nesta etapa)

| Variável | Padrão | Descrição |
|---|---|---|
| `FIRECRAWL_API_KEY` | `''` | Chave Firecrawl. Vazio = Firecrawl desativado. |
| `FIRECRAWL_MODE` | `fallback` | `fallback` = direct_fetch primeiro; `preferred` = Firecrawl primeiro. |
| `GEMINI_API_KEY` | `''` | Chave Gemini. Vazio = Gemini desativado. |
| `GEMINI_ENABLED` | `false` | Deve ser `true` para ativar. Gemini é NUNCA fonte de preço — só interpreta texto já coletado. |

---

## APK Android — gerado no GitHub Actions

| Variável | Onde configurar | Descrição |
|---|---|---|
| `PRICEIQ_FRONTEND_URL` | GitHub → Settings → Actions → Variables (ou Secrets) | URL real do Vercel. Injetada em `capacitor.config.json` em build-time. Nunca commitar no repo. |

---

## Health checks disponíveis

Após o backend subir, confirme a conexão:

```bash
# Saúde geral do servidor
curl https://<backend>.onrender.com/api/health

# Resposta esperada:
# { "ok": true, "service": "priceiq-server", "environment": "production",
#   "timestamp": "...", "version": "0.1.0" }

# Saúde do banco de dados
curl https://<backend>.onrender.com/api/db/health
```

Do frontend Next.js (via função `getApiHealth()` em `web/src/lib/api.ts`):

```typescript
import { getApiHealth } from '@/lib/api';
const health = await getApiHealth();
console.log(health.ok, health.environment, health.version);
```

---

## Checklist de conexão

1. Render `priceiq-server` está **Live** → anote a URL `https://priceiq-server.onrender.com`
2. `FRONTEND_URL` no Render = URL exata do Vercel (sem barra final)
3. `NEXT_PUBLIC_API_URL` no Vercel = URL do Render (sem barra final)
4. `GET /api/health` retorna `{ ok: true }` → backend OK
5. Abrir o Vercel no browser → busca responde → conexão OK
6. `PRICEIQ_FRONTEND_URL` configurado no GitHub → gerar APK → APK abre Vercel

---

## O que NÃO é a entrada real

- `index.html` na raiz — página de aviso de deprecação para quem acessa o GitHub Pages antigo.
- `legacy/index.html` — app legado preservado por histórico. Não é deployado em nenhum lugar.

Veja também: `docs/deployment-entrypoint.md`
