/**
 * sitemapDiscovery — descobre URLs de produto a partir do sitemap do fornecedor
 * (Etapa 15).
 *
 * Fonte mais barata quando disponível: muitos e-commerces publicam
 * /sitemap.xml ou /sitemap_index.xml (ou apontam via robots.txt). Lemos os
 * <loc>, filtramos URLs com cara de produto (linkClassifier) e do mesmo
 * domínio, e devolvemos candidatas.
 *
 * Limites de segurança (não baixar a internet inteira):
 *   - no máximo SITEMAP_MAX_FETCHES sitemaps candidatos tentados;
 *   - no máximo SITEMAP_MAX_CHILDREN sub-sitemaps de um índice;
 *   - no máximo SITEMAP_MAX_URLS URLs coletadas no total.
 *
 * NUNCA lança: se nada funcionar, devolve fetchStatus controlado (error/blocked)
 * com urls vazias.
 */
import { getSupplierDomain } from '../discovery/candidateUrlExtractor.js';
import { classifyUrl } from '../../extractors/linkClassifier.js';
import { makeSearchAttempt } from '../diagnostics/searchAttempt.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';
import type {
  DiscoveredUrl,
  SourceDiscoveryResult,
  SourceFetchStatus,
} from './catalogDiscoveryTypes.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const SITEMAP_MAX_FETCHES = 4;
const SITEMAP_MAX_CHILDREN = 3;
const SITEMAP_MAX_URLS = 300;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Extrai o conteúdo de todos os <loc>…</loc> de um XML de sitemap. */
export function parseSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const rx = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml)) !== null) {
    const loc = m[1]?.trim();
    if (loc) out.push(loc.replace(/&amp;/g, '&'));
  }
  return out;
}

/** É um índice de sitemaps (aponta para outros sitemaps)? */
function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Parseia linhas `Sitemap: <url>` de um robots.txt. */
export function parseRobotsSitemaps(robotsTxt: string): string[] {
  const out: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap:\s*(\S+)/i);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

interface FetchTextResult {
  ok: boolean;
  status: number;
  text: string;
}

async function fetchText(
  doFetch: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<FetchTextResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    return { ok: res.ok, status: res.status, text };
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0, text: '' };
  }
}

export interface DiscoverViaSitemapInput {
  supplier: { site: string };
  query: string;
  fetchFn?: FetchLike;
  maxUrls?: number;
  timeoutMs?: number;
}

/**
 * Tenta robots.txt + sitemap.xml + sitemap_index.xml, parseia <loc>, filtra
 * produtos do mesmo domínio. Devolve SourceDiscoveryResult.
 */
export async function discoverViaSitemap(
  input: DiscoverViaSitemapInput,
): Promise<SourceDiscoveryResult> {
  const doFetch: FetchLike = input.fetchFn ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxUrls = input.maxUrls ?? SITEMAP_MAX_URLS;
  const domain = getSupplierDomain(input.supplier);
  const base = `https://${domain}`;
  const attempts: SearchAttempt[] = [];

  // 1. robots.txt → Sitemap: …  (best-effort)
  const robots = await fetchText(doFetch, `${base}/robots.txt`, timeoutMs);
  const fromRobots = robots.ok ? parseRobotsSitemaps(robots.text) : [];

  // 2. Candidatos de sitemap (robots primeiro, depois os padrões).
  const candidates = Array.from(
    new Set([...fromRobots, `${base}/sitemap.xml`, `${base}/sitemap_index.xml`]),
  ).slice(0, SITEMAP_MAX_FETCHES);

  const productUrls: DiscoveredUrl[] = [];
  const seen = new Set<string>();
  let anyBlocked = false;
  let anyFetched = false;
  let fetchedXml = false;

  function addLoc(loc: string): void {
    if (productUrls.length >= maxUrls) return;
    if (!/^https?:\/\//i.test(loc)) return;
    if (seen.has(loc)) return;
    seen.add(loc);
    const cls = classifyUrl(loc).type;
    if (cls === 'product' || cls === 'unknown') {
      productUrls.push({ url: loc });
    }
  }

  for (const sitemapUrl of candidates) {
    if (productUrls.length >= maxUrls) break;
    const r = await fetchText(doFetch, sitemapUrl, timeoutMs);
    anyFetched = anyFetched || r.status > 0;
    if (r.status === 403 || r.status === 429 || r.status === 451) {
      anyBlocked = true;
      continue;
    }
    if (!r.ok || !/<loc>/i.test(r.text)) continue;
    fetchedXml = true;

    if (isSitemapIndex(r.text)) {
      const children = parseSitemapLocs(r.text).slice(0, SITEMAP_MAX_CHILDREN);
      for (const child of children) {
        if (productUrls.length >= maxUrls) break;
        const cr = await fetchText(doFetch, child, timeoutMs);
        if (cr.status === 403 || cr.status === 429 || cr.status === 451) {
          anyBlocked = true;
          continue;
        }
        if (!cr.ok || !/<loc>/i.test(cr.text)) continue;
        for (const loc of parseSitemapLocs(cr.text)) addLoc(loc);
      }
    } else {
      for (const loc of parseSitemapLocs(r.text)) addLoc(loc);
    }
  }

  // 3. Determinar fetchStatus controlado.
  let fetchStatus: SourceFetchStatus;
  let errorMessage: string | undefined;
  if (fetchedXml) {
    fetchStatus = 'success';
  } else if (anyBlocked) {
    fetchStatus = 'blocked';
    errorMessage = 'sitemap bloqueado pelo destino';
  } else if (anyFetched) {
    fetchStatus = 'error';
    errorMessage = 'sitemap não encontrado ou inválido';
  } else {
    fetchStatus = 'error';
    errorMessage = 'sitemap inacessível';
  }

  attempts.push(
    makeSearchAttempt({
      step: 'sitemap',
      status:
        fetchStatus === 'success'
          ? productUrls.length > 0
            ? 'candidate_found'
            : 'candidate_not_found'
          : fetchStatus === 'blocked'
            ? 'blocked'
            : 'error',
      detail: `sitemap de ${domain} → ${productUrls.length} URL(s) de produto (${fetchStatus})`,
    }),
  );

  return {
    source: 'sitemap',
    fetchStatus,
    urls: productUrls,
    attempts,
    errorMessage,
  };
}
