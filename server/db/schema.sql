-- ════════════════════════════════════════════════════════
-- PriceIQ — Schema PostgreSQL (Etapa 3)
-- ════════════════════════════════════════════════════════
-- Schema idempotente — pode ser aplicado em DB vazio ou já existente.
-- Para evolução incremental use as migrações em ./migrations/

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. SUPPLIERS ─────────────────────────────────────────
-- Fornecedores (padrão + customizados pelo usuário)
CREATE TABLE IF NOT EXISTS suppliers (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT NOT NULL,
  site                 TEXT NOT NULL,
  search_url_template  TEXT NOT NULL,                  -- ex: https://lista.mercadolivre.com.br/{q}
  country              TEXT NOT NULL DEFAULT 'Brasil',
  currency             TEXT NOT NULL DEFAULT 'BRL',
  type                 TEXT NOT NULL DEFAULT 'Nacional',
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  extraction_mode      TEXT NOT NULL DEFAULT 'jina_reader',  -- jina_reader | playwright | direct_api
  extractor_config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_site_unique ON suppliers(site);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);
CREATE INDEX IF NOT EXISTS idx_suppliers_type   ON suppliers(type);

-- ─── 2. SEARCHES ──────────────────────────────────────────
-- Buscas executadas pelo usuário
CREATE TABLE IF NOT EXISTS searches (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
  selected_supplier_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  best_supplier         TEXT,
  best_total_brl        NUMERIC(14, 4),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_searches_status  ON searches(status);
CREATE INDEX IF NOT EXISTS idx_searches_created ON searches(created_at DESC);

-- ─── 3. SEARCH_RESULTS ────────────────────────────────────
-- Resultado por fornecedor para cada busca
CREATE TABLE IF NOT EXISTS search_results (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_id           UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_name        TEXT,
  seller_name         TEXT,
  price               NUMERIC(14, 4),
  freight             NUMERIC(14, 4) DEFAULT 0,
  total_price         NUMERIC(14, 4),       -- price + freight na moeda original
  currency            TEXT,
  exchange_rate_used  NUMERIC(14, 6),
  total_brl           NUMERIC(14, 4),       -- total_price convertido para BRL
  product_url         TEXT,
  match_score         INT,                  -- 0-100 quão exato é o match com a query
  confidence          INT,                  -- 0-100 confiança na extração do preço
  available           BOOLEAN,
  warning             TEXT,                 -- aviso opcional (ex: preço a partir de, frete não confirmado)
  error_message       TEXT,                 -- se o fornecedor falhou
  from_cache          BOOLEAN NOT NULL DEFAULT FALSE,
  collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Validação anti produto-fantasma
  link_type           TEXT,                 -- 'product' | 'search' | 'unverified'
  link_validated      BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_text       TEXT,                 -- trecho onde o preço foi extraído
  source_url          TEXT,                 -- URL que foi raspada
  source_name         TEXT,                 -- 'jina-direct' | 'gemini-interpreter' | scraper específico
  validation_warning  TEXT
);

CREATE INDEX IF NOT EXISTS idx_results_search       ON search_results(search_id);
CREATE INDEX IF NOT EXISTS idx_results_supplier     ON search_results(supplier_id);
CREATE INDEX IF NOT EXISTS idx_results_total_brl    ON search_results(total_brl);
CREATE INDEX IF NOT EXISTS idx_results_link_type    ON search_results(link_type);
CREATE INDEX IF NOT EXISTS idx_results_link_valid   ON search_results(link_validated);

-- ─── 4. EXCHANGE_RATES ────────────────────────────────────
-- Histórico de cotações (sempre relativas a BRL)
CREATE TABLE IF NOT EXISTS exchange_rates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  currency     TEXT NOT NULL,                       -- USD, EUR, CNY
  brl_rate     NUMERIC(14, 6) NOT NULL,
  source       TEXT NOT NULL DEFAULT 'Investing.com',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rates_currency_time ON exchange_rates(currency, collected_at DESC);

-- ─── 5. APP_SETTINGS ──────────────────────────────────────
-- Key-value store para configurações da aplicação.
-- IMPORTANTE: NÃO é local para chaves de API (essas vivem só em .env).
CREATE TABLE IF NOT EXISTS app_settings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key        TEXT NOT NULL UNIQUE,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Triggers para updated_at ─────────────────────────────
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

-- ─── Tabela de controle de migrações ──────────────────────
CREATE TABLE IF NOT EXISTS _migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
