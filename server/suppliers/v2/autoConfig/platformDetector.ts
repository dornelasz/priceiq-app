/**
 * Detecta a plataforma de e-commerce a partir de sinais no HTML da homepage.
 *
 * Função PURA — não faz I/O. Recebe HTML, devolve plataforma + confiança.
 * Cobertura: shopify, woocommerce, vtex, magento, nuvemshop, tray,
 * loja_integrada, opencart, nextjs. Sem sinal forte → 'custom'.
 */

export interface PlatformDetectorInput {
  baseUrl: string;
  homepageHtml?: string;
  headers?: Record<string, string>;
}

export interface PlatformDetectorResult {
  platformDetected: string | null;
  confidence: number;
  signals: string[];
}

interface PlatformRule {
  name: string;
  patterns: Array<{ rx: RegExp; weight: number; label: string }>;
}

const PLATFORM_RULES: PlatformRule[] = [
  {
    name: 'shopify',
    patterns: [
      { rx: /cdn\.shopify\.com/i, weight: 40, label: 'cdn.shopify.com' },
      { rx: /Shopify\.theme/i, weight: 30, label: 'Shopify.theme' },
      { rx: /shopify-section/i, weight: 20, label: 'shopify-section' },
      { rx: /\/cart\.js/i, weight: 15, label: 'cart.js' },
    ],
  },
  {
    name: 'woocommerce',
    patterns: [
      { rx: /woocommerce/i, weight: 35, label: 'woocommerce class/script' },
      { rx: /wc-ajax/i, weight: 25, label: 'wc-ajax' },
      { rx: /wp-content\/plugins\/woocommerce/i, weight: 30, label: 'wp-content plugins woo' },
      { rx: /wc_add_to_cart/i, weight: 15, label: 'wc_add_to_cart' },
    ],
  },
  {
    name: 'vtex',
    patterns: [
      { rx: /\/api\/catalog_system\//i, weight: 40, label: 'vtex catalog_system' },
      { rx: /__RUNTIME__/i, weight: 25, label: '__RUNTIME__' },
      { rx: /vtexcommercestable/i, weight: 30, label: 'vtex domain' },
      { rx: /portal\.vtexcommerce/i, weight: 30, label: 'portal vtex' },
    ],
  },
  {
    name: 'magento',
    patterns: [
      { rx: /Magento_Theme/i, weight: 35, label: 'Magento_Theme' },
      { rx: /mage\/cookies/i, weight: 25, label: 'mage/cookies' },
      { rx: /catalogsearch\/result/i, weight: 25, label: 'catalogsearch/result' },
      { rx: /static\/version\d+\/frontend/i, weight: 20, label: 'magento static' },
    ],
  },
  {
    name: 'nuvemshop',
    patterns: [
      { rx: /tiendanube/i, weight: 35, label: 'tiendanube' },
      { rx: /nuvemshop/i, weight: 35, label: 'nuvemshop' },
      { rx: /cdn\.tiendanube/i, weight: 30, label: 'cdn.tiendanube' },
    ],
  },
  {
    name: 'tray',
    patterns: [
      { rx: /traycheckout/i, weight: 35, label: 'traycheckout' },
      { rx: /tray\.com\.br/i, weight: 25, label: 'tray.com.br' },
      { rx: /commercesuite/i, weight: 30, label: 'commercesuite' },
    ],
  },
  {
    name: 'loja_integrada',
    patterns: [
      { rx: /loja\s*integrada/i, weight: 30, label: 'loja integrada texto' },
      { rx: /cdn\.awsli\.com\.br/i, weight: 40, label: 'cdn.awsli.com.br' },
      { rx: /lojaintegrada/i, weight: 35, label: 'lojaintegrada' },
    ],
  },
  {
    name: 'opencart',
    patterns: [
      { rx: /route=product\//i, weight: 35, label: 'route=product' },
      { rx: /index\.php\?route=/i, weight: 30, label: 'index.php route' },
    ],
  },
  {
    name: 'nextjs',
    patterns: [
      { rx: /<script[^>]+id=["']__NEXT_DATA__["']/i, weight: 50, label: '__NEXT_DATA__ tag' },
      { rx: /_next\/static/i, weight: 25, label: '_next/static' },
    ],
  },
];

const MIN_CONFIDENCE_FOR_PLATFORM = 35;

export function detectPlatform(
  input: PlatformDetectorInput,
): PlatformDetectorResult {
  const html = input.homepageHtml ?? '';
  if (!html) {
    return { platformDetected: 'custom', confidence: 0, signals: [] };
  }

  let best: { name: string; confidence: number; signals: string[] } | null = null;

  for (const rule of PLATFORM_RULES) {
    const matched: string[] = [];
    let score = 0;
    for (const p of rule.patterns) {
      if (p.rx.test(html)) {
        matched.push(`${rule.name}:${p.label}`);
        score += p.weight;
      }
    }
    if (score === 0) continue;
    const confidence = Math.min(95, score);
    if (!best || confidence > best.confidence) {
      best = { name: rule.name, confidence, signals: matched };
    }
  }

  if (best && best.confidence >= MIN_CONFIDENCE_FOR_PLATFORM) {
    return {
      platformDetected: best.name,
      confidence: best.confidence,
      signals: best.signals,
    };
  }

  return {
    platformDetected: 'custom',
    confidence: best?.confidence ?? 0,
    signals: best?.signals ?? [],
  };
}
