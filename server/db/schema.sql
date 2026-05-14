-- ════════════════════════════════════════════════════════
-- PriceIQ — Schema do banco de dados
-- ════════════════════════════════════════════════════════
-- Roda idempotentemente em qualquer Postgres ≥ 13

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Fornecedores ─────────────────────────────────────────
-- user_id NULL = fornecedor global/padrão (Mercado Livre, Amazon, etc)
-- user_id NOT NULL = fornecedor customizado adicionado pelo usuário
CREATE TABLE IF NOT EXISTS suppliers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID,
  name          TEXT NOT NULL,
  site          TEXT NOT NULL,
  url_template  TEXT,
  type          TEXT NOT NULL DEFAULT 'Nacional',
  country       TEXT NOT NULL DEFAULT 'Brasil',
  currency      TEXT NOT NULL DEFAULT 'BRL',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_user    ON suppliers(user_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_enabled ON suppliers(enabled);
CREATE INDEX IF NOT EXISTS idx_suppliers_site    ON suppliers(site);

-- ─── Buscas ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS searches (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID,
  query                TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
  total_suppliers      INT NOT NULL DEFAULT 0,
  completed_suppliers  INT NOT NULL DEFAULT 0,
  best_price_brl       NUMERIC(14, 4),
  best_supplier        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_searches_user    ON searches(user_id);
CREATE INDEX IF NOT EXISTS idx_searches_status  ON searches(status);
CREATE INDEX IF NOT EXISTS idx_searches_created ON searches(created_at DESC);

-- ─── Resultados ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_results (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_id       UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_name   TEXT NOT NULL,
  found           BOOLEAN NOT NULL DEFAULT FALSE,
  product_name    TEXT,
  price           NUMERIC(14, 4),
  currency        TEXT,
  price_brl       NUMERIC(14, 4),
  link            TEXT,
  link_type       TEXT,                           -- 'product' | 'search'
  seller_name     TEXT,
  product_rating  NUMERIC(4, 2),
  product_reviews INT,
  freight         NUMERIC(14, 4) DEFAULT 0,
  freight_note    TEXT,
  free_ship       BOOLEAN DEFAULT FALSE,
  total_brl       NUMERIC(14, 4),
  confidence      INT,
  source_text     TEXT,
  error_message   TEXT,
  raw_data        JSONB,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_search   ON search_results(search_id);
CREATE INDEX IF NOT EXISTS idx_results_supplier ON search_results(supplier_id);
CREATE INDEX IF NOT EXISTS idx_results_found    ON search_results(found);

-- ─── Cotações ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS currency_rates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pair        TEXT NOT NULL,                      -- USD-BRL, EUR-BRL, CNY-BRL
  value       NUMERIC(14, 4) NOT NULL,
  source      TEXT NOT NULL DEFAULT 'Investing.com',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rates_pair_time ON currency_rates(pair, fetched_at DESC);

-- ─── Trigger: updated_at ────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_suppliers_updated_at ON suppliers;
CREATE TRIGGER update_suppliers_updated_at
BEFORE UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
