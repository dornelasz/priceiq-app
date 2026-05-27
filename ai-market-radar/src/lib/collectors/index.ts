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

    case "GITHUB": {
      // GitHub exposes real, public Atom feeds (e.g. <repo>/releases.atom,
      // <repo>/commits.atom, <user>.atom). Those are reliable feeds, so we
      // parse them with the RSS/Atom collector. Non-feed pages (e.g. /trending)
      // have no official feed — we don't run a broken collector for those.
      const lower = source.url.toLowerCase();
      const isFeed = lower.endsWith(".atom") || lower.endsWith(".xml") || lower.includes("/releases.atom");
      if (isFeed) {
        return { items: await collectRss(input), warnings: [] };
      }
      return {
        items: [],
        warnings: [
          "Coletor GitHub: cadastre um feed .atom público (ex.: <repo>/releases.atom). Páginas como /trending não têm feed oficial.",
        ],
      };
    }

    default:
      return {
        items: [],
        warnings: [`Tipo de fonte sem coletor: ${String(source.type)}`],
      };
  }
}
