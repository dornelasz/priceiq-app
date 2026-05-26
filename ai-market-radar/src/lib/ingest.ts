import { dedupeBatch, findDuplicate, type ExistingArticleRef } from "./dedup";
import { computeLocalScore } from "./relevance";
import { canonicalizeUrl, contentHash } from "./url";
import type { CollectedItem } from "./collectors/types";

export interface NewArticleInput {
  sourceId: string;
  title: string;
  url: string;
  canonicalUrl: string;
  author: string | null;
  publishedAt: Date | null;
  rawExcerpt: string | null;
  rawContent: string | null;
  contentHash: string;
  language: string | null;
  localScore: number;
}

export interface IngestPlan {
  toCreate: NewArticleInput[];
  duplicates: Array<{ url: string; reason: string }>;
  invalid: number;
}

/** Turn one collected item into a DB-ready article input (canonical URL, hash, score). */
export function buildArticleInput(item: CollectedItem, sourceId: string): NewArticleInput {
  const canonical = canonicalizeUrl(item.url);
  const hash = contentHash({ url: item.url, title: item.title, excerpt: item.excerpt });
  const localScore = computeLocalScore({
    title: item.title,
    excerpt: item.excerpt,
    content: item.content,
  });
  return {
    sourceId,
    title: item.title.slice(0, 500),
    url: item.url,
    canonicalUrl: canonical,
    author: item.author ?? null,
    publishedAt: item.publishedAt,
    rawExcerpt: item.excerpt,
    rawContent: item.content,
    contentHash: hash,
    language: item.language ?? null,
    localScore,
  };
}

/**
 * Plan an ingest: validate, de-dupe within the batch, then drop anything that
 * duplicates an already-stored article. Pure — the DB layer just persists
 * `toCreate`. This is the core of rule 13 (deduplication).
 */
export function planIngest(
  items: CollectedItem[],
  sourceId: string,
  existing: ExistingArticleRef[],
): IngestPlan {
  const duplicates: Array<{ url: string; reason: string }> = [];
  let invalid = 0;

  const candidates: NewArticleInput[] = [];
  for (const item of items) {
    if (!item.url?.trim() || !item.title?.trim()) {
      invalid += 1;
      continue;
    }
    candidates.push(buildArticleInput(item, sourceId));
  }

  const { unique, dropped } = dedupeBatch(
    candidates.map((c) => ({
      ...c,
      // dedupeBatch only needs these fields:
      canonicalUrl: c.canonicalUrl,
      contentHash: c.contentHash,
      title: c.title,
      sourceId: c.sourceId,
    })),
  );
  for (let i = 0; i < dropped; i += 1) {
    duplicates.push({ url: "(intra-lote)", reason: "batch-duplicate" });
  }

  const toCreate: NewArticleInput[] = [];
  for (const candidate of unique) {
    const match = findDuplicate(
      {
        canonicalUrl: candidate.canonicalUrl,
        contentHash: candidate.contentHash,
        title: candidate.title,
        sourceId: candidate.sourceId,
      },
      existing,
    );
    if (match) {
      duplicates.push({ url: candidate.canonicalUrl, reason: match.reason });
      continue;
    }
    toCreate.push(candidate);
  }

  return { toCreate, duplicates, invalid };
}
