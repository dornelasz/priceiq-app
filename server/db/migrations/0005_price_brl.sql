-- ════════════════════════════════════════════════════════
-- Migration 0005 — preço convertido em BRL sem frete (resultado parcial)
-- ════════════════════════════════════════════════════════
-- Adiciona coluna 'price_brl' em search_results.
--
-- Motivação: um resultado pode ser parcial — produto + preço + moeda + link
-- + evidência confirmados, mas frete desconhecido. Nesse caso total_brl fica
-- NULL (não há total final confirmável), mas ainda queremos exibir o preço
-- convertido em BRL. price_brl = preço (sem frete) convertido para BRL.
--
-- Relação:
--   total_brl  = (preço + frete) convertido — só quando frete é confirmado/grátis.
--   price_brl  = preço convertido — disponível sempre que houver preço + moeda.
--
-- Não destrutiva. Linhas antigas terão price_brl NULL.

ALTER TABLE search_results
  ADD COLUMN IF NOT EXISTS price_brl NUMERIC(14, 4);
