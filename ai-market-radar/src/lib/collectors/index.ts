import type { SourceType } from "@prisma/client";
import { collectArxiv, isArxivUrl } from "./arxiv";
import { collectRss } from "./rss";
import type { CollectorResult } from "./types";
import { collectWebPage } from "./webpage";

export type { CollectedItem, CollectorResult } from "./types";

export interface CollectableSource {
  url: string;
  name: string;
  type: SourceType;
}

/**
 * Dispatch a source to the right collector. Network/parse failures throw
 * (the caller records the error per-source and keeps going). Config gaps —
 * e.g. a GitHub source with no usable public feed — return an empty result
 * with a warning instead of a broken/throwing collector.
 */
export async function collectSource(
  source: CollectableSource,
  signal?: AbortSignal,
): Promise<CollectorResult> {
  const input = { url: source.url, sourceName: source.name, signal };

  switch (source.type) {
    case "RSS":
    case "BLOG":
    case "PRODUCT_LAUNCH":
      return { items: await collectRss(input), warnings: [] };

    case "PAPER":
      return {
        items: isArxivUrl(source.url) ? await collectArxiv(input) : await collectRss(input),
        warnings: [],
      };

    case "SITE":
    case "OTHER":
      return { items: await collectWebPage(input), warnings: [] };

    case "GITHUB":
      return {
        items: [],
        warnings: [
          "Coletor GitHub não implementado: cadastre o RSS/Atom público do repositório (ex.: releases.atom) ou use uma fonte com feed estável.",
        ],
      };

    default:
      return {
        items: [],
        warnings: [`Tipo de fonte sem coletor: ${String(source.type)}`],
      };
  }
}
