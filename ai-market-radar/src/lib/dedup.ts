import { isSimilarTitle, normalizeUrl } from "./url";

export type DuplicateReason = "url" | "hash" | "similar-title";

export interface ExistingArticleRef {
  canonicalUrl: string;
  contentHash: string;
  title: string;
  sourceId: string;
  publishedAt?: Date | null;
}

export interface DedupCandidate {
  canonicalUrl: string;
  contentHash: string;
  title: string;
  sourceId: string;
}

export interface DuplicateMatch {
  reason: DuplicateReason;
  existing: ExistingArticleRef;
}

const SIMILAR_TITLE_THRESHOLD = 0.82;

/**
 * Decide whether `candidate` duplicates any of the `existing` articles.
 * Order of checks: exact canonical URL → content hash → very similar title
 * from the SAME source. Returns the match (with reason) or null.
 */
export function findDuplicate(
  candidate: DedupCandidate,
  existing: ExistingArticleRef[],
): DuplicateMatch | null {
  const candUrl = normalizeUrl(candidate.canonicalUrl);

  for (const ref of existing) {
    if (normalizeUrl(ref.canonicalUrl) === candUrl) {
      return { reason: "url", existing: ref };
    }
  }
  for (const ref of existing) {
    if (ref.contentHash && ref.contentHash === candidate.contentHash) {
      return { reason: "hash", existing: ref };
    }
  }
  for (const ref of existing) {
    if (ref.sourceId !== candidate.sourceId) continue;
    if (isSimilarTitle(ref.title, candidate.title, SIMILAR_TITLE_THRESHOLD)) {
      return { reason: "similar-title", existing: ref };
    }
  }
  return null;
}

/**
 * Remove duplicates *within a single batch* (e.g. one feed returning the same
 * item twice). Keeps the first occurrence. Returns the unique candidates and
 * how many were dropped.
 */
export function dedupeBatch<T extends DedupCandidate>(candidates: T[]): {
  unique: T[];
  dropped: number;
} {
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  const unique: T[] = [];
  let dropped = 0;

  for (const c of candidates) {
    const url = normalizeUrl(c.canonicalUrl);
    if (seenUrls.has(url) || (c.contentHash && seenHashes.has(c.contentHash))) {
      dropped += 1;
      continue;
    }
    seenUrls.add(url);
    if (c.contentHash) seenHashes.add(c.contentHash);
    unique.push(c);
  }
  return { unique, dropped };
}
