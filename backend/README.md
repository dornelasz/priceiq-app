# Backend — PriceIQ

API do PriceIQ.

## Estado

🚧 **Em construção** — Etapa 3.

## Escopo planejado

- **Cotação:** proxy server-side da Investing.com com cache Redis (evita rate-limit dos CORS proxies do browser)
- **Busca:** proxy de Jina Reader / scraping de fornecedores com cache
- **Usuários:** persistência de fornecedores customizados e histórico
- **Auth:** JWT, OAuth
- **Billing:** futuro (Stripe?)

## Stack tentativa

Node.js + Fastify + Prisma + Postgres + Redis. A definir em ADR na Etapa 3.

## Endpoints planejados (rascunho)

```
GET  /api/rates                 → cotação atual (USD/EUR/CNY)
GET  /api/rates/history?days=N  → histórico de cotações
POST /api/search                → busca em fornecedores
GET  /api/suppliers             → lista fornecedores do usuário
POST /api/suppliers             → adiciona fornecedor customizado
GET  /api/history               → histórico de buscas do usuário
```
