-- ════════════════════════════════════════════════════════
-- Migration 0006 — Supplier Product Catalog
-- ════════════════════════════════════════════════════════
-- Cria as tabelas de catálogo de produtos por fornecedor:
--   A) supplier_product_candidates — URLs candidatas com dados extraídos
--   B) supplier_product_matches    — vínculo query ↔ candidato com status
--   C) supplier_discovery_runs     — histórico de execuções de discovery
--
-- Não destrutiva: usa IF NOT EXISTS em todo lugar.

-- ─── A) supplier_product_candidates ──────────────────────────────────────────
-- Deduplicado por (supplier_id, url_hash). Uma URL por fornecedor, atualizada
-- in-place a cada nova extração sem gerar duplicatas.

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

CREATE INDEX IF NOT EXISTS idx_spc_supplier       ON supplier_product_candidates(supplier_id);
CREATE INDEX IF NOT EXISTS idx_spc_norm_query     ON supplier_product_candidates(normalized_query);
CREATE INDEX IF NOT EXISTS idx_spc_status         ON supplier_product_candidates(status);
CREATE INDEX IF NOT EXISTS idx_spc_last_checked   ON supplier_product_candidates(last_checked_at);

DROP TRIGGER IF EXISTS trg_spc_updated_at ON supplier_product_candidates;
CREATE TRIGGER trg_spc_updated_at
BEFORE UPDATE ON supplier_product_candidates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── B) supplier_product_matches ─────────────────────────────────────────────
-- Deduplicado por (supplier_id, candidate_id, normalized_query).
-- Registra o resultado do matching entre uma query e uma URL candidata.

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

-- ─── C) supplier_discovery_runs ──────────────────────────────────────────────
-- Cada execução do pipeline de discovery gera um run. Permite auditoria
-- histórica sem afetar as tabelas de candidatos/matches.

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
