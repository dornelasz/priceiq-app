/**
 * Run an async fn over items sequentially, isolating failures: one item
 * throwing never aborts the others. Used by the worker so a single broken
 * source can't take down a whole collection cycle.
 */
export async function runIsolated<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<{ results: R[]; errors: Array<{ item: T; error: unknown }> }> {
  const results: R[] = [];
  const errors: Array<{ item: T; error: unknown }> = [];
  for (const item of items) {
    try {
      results.push(await fn(item));
    } catch (error) {
      errors.push({ item, error });
    }
  }
  return { results, errors };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
