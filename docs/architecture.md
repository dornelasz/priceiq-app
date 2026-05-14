# Arquitetura — PriceIQ

## Visão geral (alvo)

```
┌───────────────┐       ┌────────────────┐
│   Frontend    │──────▶│    Backend     │
│   (SPA/PWA)   │  REST │   (Node API)   │
└───────────────┘       └───────┬────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
          ┌─────────┐     ┌─────────┐     ┌──────────┐
          │Postgres │     │  Redis  │     │ External │
          │ (dados) │     │ (cache) │     │   APIs   │
          └─────────┘     └─────────┘     └──────────┘
                                          (Investing, Jina, Gemini)
```

## Estado atual (pré-migração)

App single-file (`index.html`):
- **Cotação Investing:** fetch direto do browser via 3 hosts × 3 CORS proxies em paralelo (Promise.any). Aceita atualização parcial (1-3 moedas).
- **Busca:** Jina Reader (fetch via CORS proxy) + Gemini API (chave do usuário) para extração estruturada.
- **Persistência:** `localStorage` do navegador (suppliers, settings, history).
- **Deploy:** GitHub Pages a partir do branch `gh-pages`.

## Migração para SaaS

### Por que migrar?
- **Cache server-side** de cotação reduz hits em CORS proxies (mais estável + rápido)
- **Auth e billing** permitem versão comercial
- **Histórico centralizado** entre dispositivos
- **Backend isola** CORS/scraping/chaves de API dos usuários finais
- **Multi-tenancy** para versão SaaS

### Princípios da migração
1. **Não quebrar o app atual** durante a migração — `index.html` continua em produção até o frontend novo estar 100%
2. **Preservar 100% da UI** — só backend é novo, frontend é re-implementação 1:1
3. **Cotação Investing intocada** — algoritmo atual (Promise.any em 9 tentativas + atualização parcial) é o estado da arte para o caso, será apenas movido para o backend
4. **Migração incremental** — uma etapa por PR, cada PR commitável e revisável

## Etapas

### ✅ Etapa 1 — Estrutura
Este PR. Apenas configs e pastas, sem mudança funcional.

### Etapa 2 — Frontend modular
Migrar `index.html` para `frontend/` com Vite + framework. Preservar UI exata.

### Etapa 3 — Backend mínimo (cotação)
Mover lógica de fetch da Investing para `backend/` com cache Redis. Frontend passa a consumir `/api/rates` do backend.

### Etapa 4 — Persistência
Mover suppliers/history do localStorage para Postgres via backend.

### Etapa 5 — Auth + billing
Adicionar login, multi-tenancy, billing.

## Decisões pendentes

- Framework frontend (React vs Vue vs Svelte vs vanilla) — ADR na Etapa 2
- Framework backend (Fastify vs Express vs Hono) — ADR na Etapa 3
- ORM (Prisma vs Drizzle) — ADR na Etapa 3
- Host de produção — Etapa 5
