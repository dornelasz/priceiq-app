-- ════════════════════════════════════════════════════════
-- Migration 0001 — schema inicial PriceIQ (Etapa 3)
-- ════════════════════════════════════════════════════════
-- Cria todas as tabelas, índices e triggers do zero.
-- Aplicado por server/db/migrator.ts; também executável standalone via psql.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS suppliers (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT NOT NULL,
  site                 TEXT NOT NULL,
  search_url_template  TEXT NOT NULL,
  country              TEXT NOT NULL DEFAULT 'Brasil',
  currency             TEXT NOT NULL DEFAULT 'BRL',
  type                 TEXT NOT NULL DEFAULT 'Nacional',
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  extraction_mode      TEXT NOT NULL DEFAULT 'jina_reader',
  extractor_config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_site_unique ON suppliers(site);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);
CREATE INDEX IF NOT EXISTS idx_suppliers_type   ON suppliers(type);

CREATE TABLE IF NOT EXISTS searches (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  selected_supplier_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  best_supplier         TEXT,
  best_total_brl        NUMERIC(14, 4),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_searches_status  ON searches(status);
CREATE INDEX IF NOT EXISTS idx_searches_created ON searches(created_at DESC);

CREATE TABLE IF NOT EXISTS search_results (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_id           UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_name        TEXT,
  seller_name         TEXT,
  price               NUMERIC(14, 4),
  freight             NUMERIC(14, 4) DEFAULT 0,
  total_price         NUMERIC(14, 4),
  currency            TEXT,
  exchange_rate_used  NUMERIC(14, 6),
  total_brl           NUMERIC(14, 4),
  product_url         TEXT,
  match_score         INT,
  confidence          INT,
  available           BOOLEAN,
  warning             TEXT,
  error_message       TEXT,
  from_cache          BOOLEAN NOT NULL DEFAULT FALSE,
  collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_search    ON search_results(search_id);
CREATE INDEX IF NOT EXISTS idx_results_supplier  ON search_results(supplier_id);
CREATE INDEX IF NOT EXISTS idx_results_total_brl ON search_results(total_brl);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  currency     TEXT NOT NULL,
  brl_rate     NUMERIC(14, 6) NOT NULL,
  source       TEXT NOT NULL DEFAULT 'Investing.com',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rates_currency_time ON exchange_rates(currency, collected_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key        TEXT NOT NULL UNIQUE,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers;
CREATE TRIGGER trg_suppliers_updated_at
BEFORE UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_updated_at
BEFORE UPDATE ON app_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
