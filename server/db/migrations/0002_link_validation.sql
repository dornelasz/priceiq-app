-- ════════════════════════════════════════════════════════
-- Migration 0002 — validação de link + evidence (anti produto fantasma)
-- ════════════════════════════════════════════════════════
-- Adiciona campos para rastrear:
--   - tipo do link (produto/busca/não-verificado)
--   - se o link foi validado
--   - trecho de evidence onde o preço foi extraído
--   - URL/nome da fonte (jina, scraper específico, playwright, etc)
--   - warning específico de validação

ALTER TABLE search_results
  ADD COLUMN IF NOT EXISTS link_type           TEXT,
  ADD COLUMN IF NOT EXISTS link_validated      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evidence_text       TEXT,
  ADD COLUMN IF NOT EXISTS source_url          TEXT,
  ADD COLUMN IF NOT EXISTS source_name         TEXT,
  ADD COLUMN IF NOT EXISTS validation_warning  TEXT;

CREATE INDEX IF NOT EXISTS idx_results_link_type ON search_results(link_type);
CREATE INDEX IF NOT EXISTS idx_results_link_validated ON search_results(link_validated);
