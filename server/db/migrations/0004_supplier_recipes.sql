-- ════════════════════════════════════════════════════════
-- Migration 0004 — supplier_recipes + status do fornecedor (Fase B do Universal Adapter V2)
-- ════════════════════════════════════════════════════════
-- 1. Adiciona certification_status / setup_status / auto_configured_at em suppliers.
-- 2. Cria tabela supplier_recipes (uma receita por fornecedor) com CHECK constraints
--    espelhando os enums da Fase A (SupplierCertificationStatus, ExtractionStrategy).
-- 3. Faz backfill: para cada supplier com search_url_template não vazio,
--    cria uma supplier_recipe 'unconfigured' marcada como legacy_search_url_template.
--
-- NÃO destrutiva. A coluna antiga suppliers.search_url_template é PRESERVADA
-- porque o motor de busca atual ainda depende dela. Sua remoção é tarefa
-- de uma fase futura, após a troca do worker.

-- ─── 1. Colunas de status em suppliers ──────────────────────────────────
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS certification_status TEXT NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN IF NOT EXISTS setup_status         TEXT NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN IF NOT EXISTS auto_configured_at   TIMESTAMPTZ NULL;

-- CHECK constraints (mesma lista de SupplierCertificationStatus na Fase A)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_certification_status_check'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_certification_status_check
      CHECK (certification_status IN (
        'unconfigured','auto_configuring','certified','needs_guided_setup',
        'blocked','requires_login','unsupported','failed'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_setup_status_check'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_setup_status_check
      CHECK (setup_status IN (
        'unconfigured','auto_configuring','certified','needs_guided_setup',
        'blocked','requires_login','unsupported','failed'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_suppliers_certification_status ON suppliers(certification_status);
CREATE INDEX IF NOT EXISTS idx_suppliers_setup_status         ON suppliers(setup_status);

-- ─── 2. Tabela supplier_recipes ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_recipes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id           UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'unconfigured',
  platform_detected     TEXT NULL,
  search_url_template   TEXT NULL,
  product_url_patterns  JSONB NOT NULL DEFAULT '[]'::jsonb,
  extraction_strategy   TEXT NULL,
  title_selector        TEXT NULL,
  price_selector        TEXT NULL,
  currency_selector     TEXT NULL,
  image_selector        TEXT NULL,
  availability_selector TEXT NULL,
  jsonld_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  json_paths            JSONB NULL,
  requires_js           BOOLEAN NOT NULL DEFAULT FALSE,
  requires_browser      BOOLEAN NOT NULL DEFAULT FALSE,
  confidence            NUMERIC NULL,
  last_tested_at        TIMESTAMPTZ NULL,
  last_success_at       TIMESTAMPTZ NULL,
  last_error            TEXT NULL,
  config_json           JSONB NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_recipes_supplier_unique UNIQUE (supplier_id),
  CONSTRAINT supplier_recipes_status_check CHECK (status IN (
    'unconfigured','auto_configuring','certified','needs_guided_setup',
    'blocked','requires_login','unsupported','failed'
  )),
  CONSTRAINT supplier_recipes_strategy_check CHECK (
    extraction_strategy IS NULL OR extraction_strategy IN (
      'json_ld','schema_org','meta_tags','script_json','next_data','dom',
      'visual_heuristic','jina_fallback','playwright_fallback','guided_selector',
      'specialized_adapter'
    )
  ),
  CONSTRAINT supplier_recipes_confidence_check CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 100)
  )
);

CREATE INDEX IF NOT EXISTS supplier_recipes_supplier_id_idx ON supplier_recipes(supplier_id);
CREATE INDEX IF NOT EXISTS supplier_recipes_status_idx      ON supplier_recipes(status);

-- Trigger de updated_at — reutiliza a função set_updated_at() criada em 0001.
DROP TRIGGER IF EXISTS trg_supplier_recipes_updated_at ON supplier_recipes;
CREATE TRIGGER trg_supplier_recipes_updated_at
BEFORE UPDATE ON supplier_recipes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. Backfill: recipe legacy a partir de search_url_template ─────────
-- NÃO marca como 'certified' — só registra o template antigo como referência.
-- A certificação real virá das fases AutoConfig/GuidedSetup.
INSERT INTO supplier_recipes (supplier_id, status, search_url_template, config_json)
SELECT
  s.id,
  'unconfigured',
  s.search_url_template,
  '{"source":"legacy_search_url_template"}'::jsonb
FROM suppliers s
WHERE s.search_url_template IS NOT NULL
  AND s.search_url_template <> ''
ON CONFLICT (supplier_id) DO NOTHING;
