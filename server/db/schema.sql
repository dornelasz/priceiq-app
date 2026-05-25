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
  total_brl           NUMERIC(14, 4),       -- (price+freight) convertido — só com frete confirmado/grátis
  price_brl           NUMERIC(14, 4),       -- price convertido (sem frete) — disponível em resultado parcial
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
  validation_warning  TEXT,
  -- Contrato único de status (Etapa 2 + partial da Etapa 3)
  status              TEXT                  -- validated|cached|partial|not_found|blocked|invalid_link|price_not_found|product_mismatch|timeout|error
);

CREATE INDEX IF NOT EXISTS idx_results_search       ON search_results(search_id);
CREATE INDEX IF NOT EXISTS idx_results_supplier     ON search_results(supplier_id);
CREATE INDEX IF NOT EXISTS idx_results_total_brl    ON search_results(total_brl);
CREATE INDEX IF NOT EXISTS idx_results_link_type    ON search_results(link_type);
CREATE INDEX IF NOT EXISTS idx_results_link_valid   ON search_results(link_validated);
CREATE INDEX IF NOT EXISTS idx_results_status       ON search_results(status);

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

-- ─── 6. SUPPLIER PRODUCT CATALOG (Etapa 14) ───────────────

-- 6a. supplier_product_candidates
-- URLs candidatas por fornecedor — deduplicado por (supplier_id, url_hash).
CREATE TABLE IF NOT EXISTS supplier_product_candidates (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  query_text          TEXT NOT NULL,
  normalized_query    TEXT NOT NULL,
  product_url         TEXT NOT NULL,
  canonical_url       TEXT,
  url_hash            TEXT NOT NULL,
  source              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'candidate',
  product_name        TEXT,
  brand               TEXT,
  sku                 TEXT,
  price               NUMERIC(14, 4),
  currency            TEXT,
  price_brl           NUMERIC(14, 4),
  freight             NUMERIC(14, 4),
  freight_status      TEXT,
  total_brl           NUMERIC(14, 4),
  match_score         NUMERIC(5, 2),
  confidence          NUMERIC(5, 2),
  evidence_text       TEXT,
  price_evidence_text TEXT,
  last_checked_at     TIMESTAMPTZ,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT spc_source_check CHECK (source IN (
    'search_page', 'firecrawl_search', 'firecrawl_map',
    'sitemap', 'manual_seed', 'cached_match'
  )),
  CONSTRAINT spc_status_check CHECK (status IN (
    'candidate', 'extracted', 'matched', 'rejected', 'blocked',
    'price_not_found', 'product_mismatch', 'validated', 'partial'
  )),
  CONSTRAINT spc_unique_supplier_url_hash UNIQUE (supplier_id, url_hash)
);

CREATE INDEX IF NOT EXISTS idx_spc_supplier     ON supplier_product_candidates(supplier_id);
CREATE INDEX IF NOT EXISTS idx_spc_norm_query   ON supplier_product_candidates(normalized_query);
CREATE INDEX IF NOT EXISTS idx_spc_status       ON supplier_product_candidates(status);
CREATE INDEX IF NOT EXISTS idx_spc_last_checked ON supplier_product_candidates(last_checked_at);

DROP TRIGGER IF EXISTS trg_spc_updated_at ON supplier_product_candidates;
CREATE TRIGGER trg_spc_updated_at
BEFORE UPDATE ON supplier_product_candidates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6b. supplier_product_matches
-- Vínculo query ↔ candidato — deduplicado por (supplier_id, candidate_id, normalized_query).
CREATE TABLE IF NOT EXISTS supplier_product_matches (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id      UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  candidate_id     UUID NOT NULL REFERENCES supplier_product_candidates(id) ON DELETE CASCADE,
  query_text       TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  match_status     TEXT NOT NULL DEFAULT 'pending',
  match_score      NUMERIC(5, 2),
  confidence       NUMERIC(5, 2),
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT spm_match_status_check CHECK (match_status IN ('confirmed', 'pending', 'rejected')),
  CONSTRAINT spm_unique UNIQUE (supplier_id, candidate_id, normalized_query)
);

DROP TRIGGER IF EXISTS trg_spm_updated_at ON supplier_product_matches;
CREATE TRIGGER trg_spm_updated_at
BEFORE UPDATE ON supplier_product_matches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6c. supplier_discovery_runs
-- Histórico de execuções do pipeline de discovery.
CREATE TABLE IF NOT EXISTS supplier_discovery_runs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id      UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  query_text       TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  source           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'completed',
  candidates_found INT NOT NULL DEFAULT 0,
  candidates_saved INT NOT NULL DEFAULT 0,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  CONSTRAINT sdr_source_check CHECK (source IN (
    'search_page', 'firecrawl_search', 'firecrawl_map', 'sitemap'
  )),
  CONSTRAINT sdr_status_check CHECK (status IN (
    'completed', 'partial', 'failed', 'blocked', 'no_candidates'
  ))
);

CREATE INDEX IF NOT EXISTS idx_sdr_supplier ON supplier_discovery_runs(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sdr_started  ON supplier_discovery_runs(started_at DESC);

-- ─── Tabela de controle de migrações ──────────────────────
CREATE TABLE IF NOT EXISTS _migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
