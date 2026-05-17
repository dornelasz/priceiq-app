-- ════════════════════════════════════════════════════════
-- Migration 0003 — status padronizado por resultado de fornecedor
-- ════════════════════════════════════════════════════════
-- Adiciona coluna 'status' em search_results para refletir o contrato
-- único de resultado (validated/cached/not_found/blocked/invalid_link/
-- price_not_found/product_mismatch/timeout/error).
--
-- Não destrutiva. Linhas antigas terão status NULL — o backend faz fallback
-- baseado em error_message ao ler. Novas linhas sempre virão com status.

ALTER TABLE search_results
  ADD COLUMN IF NOT EXISTS status TEXT;

CREATE INDEX IF NOT EXISTS idx_results_status ON search_results(status);
