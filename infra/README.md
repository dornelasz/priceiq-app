# Infra — PriceIQ

Configurações de infraestrutura.

## Conteúdo atual

- `../docker-compose.yml` (na raiz do projeto) — Postgres 16 + Redis 7 para dev

## Futuro

- Terraform / IaC para deploy cloud (AWS / Render / Fly.io — a decidir)
- Manifests k8s ou docker-compose de produção
- Configurações de CI/CD (.github/workflows)

## Comandos úteis

```bash
# Subir ambiente local
docker compose up -d

# Ver status
docker compose ps

# Logs em tempo real
docker compose logs -f postgres
docker compose logs -f redis

# Conectar no Postgres
docker compose exec postgres psql -U priceiq

# Conectar no Redis
docker compose exec redis redis-cli
```
