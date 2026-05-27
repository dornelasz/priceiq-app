import { describe, expect, it } from "vitest";
import { runIsolated } from "../src/lib/async";

describe("runIsolated (source failure isolation)", () => {
  it("keeps processing other items when one throws", async () => {
    const processed: number[] = [];
    const { results, errors } = await runIsolated([1, 2, 3, 4], async (n) => {
      if (n === 2) throw new Error("source 2 failed");
      processed.push(n);
      return n * 10;
    });

    // The failing item did not abort the loop.
    expect(processed).toEqual([1, 3, 4]);
    expect(results).toEqual([10, 30, 40]);
    expect(errors).toHaveLength(1);
    expect((errors[0].error as Error).message).toContain("source 2 failed");
  });

  it("returns no errors when everything succeeds", async () => {
    const { results, errors } = await runIsolated(["a", "b"], async (s) => s.toUpperCase());
    expect(results).toEqual(["A", "B"]);
    expect(errors).toHaveLength(0);
  });
});
