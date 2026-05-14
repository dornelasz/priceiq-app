# PriceIQ

> Comparador de preços com cotação ao vivo da Investing.com

## Estado atual

O PriceIQ está em transição de **app single-file** para **SaaS web completo**.

### Versão atual (produção)
- **`index.html`** — app standalone (HTML/CSS/JS), deployado em GitHub Pages
- **URL:** https://dornelasz.github.io/priceiq-app
- **Features:** busca via Gemini + Jina Reader, cotação Investing.com (USD/EUR/CNY ao vivo a cada 1min), histórico local, fornecedores customizáveis

### Migração SaaS em andamento
Estrutura sendo preparada em paralelo (sem interromper o app atual):
- `frontend/` — frontend web modular (futura migração de `index.html`)
- `backend/` — API REST (Node.js)
- `infra/` — infraestrutura como código (docker-compose, IaC)
- `docs/` — documentação de arquitetura

## Estrutura de pastas

```
priceiq-app/
├── index.html              ← App atual em produção (NÃO TOCAR)
├── frontend/               ← Frontend SaaS (em construção)
├── backend/                ← Backend API (em construção)
├── infra/                  ← Configs de infraestrutura
├── docs/                   ← Documentação
├── docker-compose.yml      ← Postgres + Redis para dev
├── .env.example            ← Template de variáveis de ambiente
└── package.json            ← Scripts e metadata
```

## Desenvolvimento

> ℹ️ Esta seção é para quem vai contribuir em ambiente cloud/local com Docker.
> O app atual (`index.html`) **não precisa** de nenhum desses serviços para funcionar.

### Subir ambiente local (futuro)

```bash
cp .env.example .env
docker compose up -d
```

Isso sobe **Postgres** (porta 5432) e **Redis** (porta 6379).

## Roadmap de migração

- [x] **Etapa 1** — Estrutura de pastas, configs base (este PR)
- [ ] **Etapa 2** — Migrar `index.html` para `frontend/` modular
- [ ] **Etapa 3** — Criar backend mínimo (cotação + cache)
- [ ] **Etapa 4** — Persistência de usuários, histórico, fornecedores customizáveis
- [ ] **Etapa 5** — Auth, billing, multi-tenancy

## Regras imutáveis

⚠️ **Não alterar** a lógica de cotação Investing.com em `index.html` — está estável e validada.
⚠️ **Não redesenhar** a UI — preservar 100% da aparência visual atual.
⚠️ **Migração incremental** — cada etapa em PR separado, sem quebrar o app em produção.

## Licença

Propriedade privada.
