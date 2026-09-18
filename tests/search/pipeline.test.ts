import { describe, expect, test } from "bun:test";
import { mapWithConcurrency, searchPipeline } from "../../src/search/pipeline.ts";
import { OpenProjectAuthenticationError, OpenProjectError } from "../../src/client/api-client.ts";
import type { FieldSpec } from "../../src/search/rank.ts";

interface Candidate {
  id: number;
  title: string;
  updatedAt: string;
}

interface Enriched {
  id: number;
  notes: string;
}

function makeCandidates(count: number): Candidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `Item ${index + 1}`,
    updatedAt: new Date(2026, 0, index + 1).toISOString(),
  }));
}

const SHALLOW: FieldSpec<Candidate>[] = [{ name: "title", weight: 3, extract: (c) => c.title }];
const DEEP: FieldSpec<Enriched>[] = [{ name: "notes", weight: 2, extract: (e) => e.notes }];

describe("mapWithConcurrency", () => {
  test("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 8, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return item;
    });

    expect(peak).toBeLessThanOrEqual(8);
  });

  test("preserves input order in the results", async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item));
      return item * 10;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  test("handles an empty input array", async () => {
    expect(await mapWithConcurrency([], 4, async (i) => i)).toEqual([]);
  });
});

describe("searchPipeline", () => {
  test("caps enrichment at the enrich limit", async () => {
    let enrichCalls = 0;

    await searchPipeline<Candidate, Enriched>(
      {
        fetchCandidates: async () => makeCandidates(100),
        shallowFields: SHALLOW,
        enrich: async (candidate) => {
          enrichCalls++;
          return { id: candidate.id, notes: "" };
        },
        deepFields: DEEP,
        recencyOf: (candidate) => candidate.updatedAt,
      },
      "item"
    );

    expect(enrichCalls).toBe(25);
  });

  test("backfills the enrichment set by recency when few candidates match shallowly", async () => {
    const enriched: number[] = [];

    await searchPipeline<Candidate, Enriched>(
      {
        fetchCandidates: async () => makeCandidates(100),
        shallowFields: SHALLOW,
        enrich: async (candidate) => {
          enriched.push(candidate.id);
          return { id: candidate.id, notes: "" };
        },
        deepFields: DEEP,
        recencyOf: (candidate) => candidate.updatedAt,
      },
      "zzzznomatch"
    );

    // Nothing matches shallowly, so the whole budget is spent on the most
    // recently updated candidates: ids 100 down to 76.
    expect(enriched).toHaveLength(25);
    expect(enriched[0]).toBe(100);
    expect(enriched).toContain(76);
    expect(enriched).not.toContain(75);
  });

  test("finds a record whose only match is in deep content", async () => {
    const result = await searchPipeline<Candidate, Enriched>(
      {
        fetchCandidates: async () => makeCandidates(10),
        shallowFields: SHALLOW,
        enrich: async (candidate) => ({
          id: candidate.id,
          notes: candidate.id === 3 ? "We agreed on the hiring freeze" : "routine notes",
        }),
        deepFields: DEEP,
        recencyOf: (candidate) => candidate.updatedAt,
      },
      "hiring freeze"
    );

    expect(result.ranked[0]!.record.id).toBe(3);
    expect(result.ranked[0]!.deep?.notes).toContain("hiring freeze");
  });

  test("takes the maximum of shallow and deep scores rather than the sum", async () => {
    const result = await searchPipeline<Candidate, Enriched>(
      {
        fetchCandidates: async () => [{ id: 1, title: "Budget", updatedAt: "2026-01-01" }],
        shallowFields: SHALLOW,
        enrich: async () => ({ id: 1, notes: "totally unrelated filler text" }),
        deepFields: DEEP,
      },
      "budget"
    );

    expect(result.ranked[0]!.score).toBeLessThanOrEqual(1);
    expect(result.ranked[0]!.score).toBeGreaterThan(0.9);
  });

  test("marks the result degraded when an enrichment fails non-fatally", async () => {
    const result = await searchPipeline<Candidate, Enriched>(
      {
        fetchCandidates: async () => makeCandidates(3),
        shallowFields: SHALLOW,
        enrich: async (candidate) => {
          if (candidate.id === 2) {
            throw new OpenProjectError("boom", { statusCode: 500 });
          }
          return { id: candidate.id, notes: "" };
        },
        deepFields: DEEP,
      },
      "item"
    );

    expect(result.degraded).toBe(true);
    expect(result.enrichmentFailures).toBe(1);
    expect(result.ranked.length).toBeGreaterThan(0);
  });

  test("propagates authentication errors instead of swallowing them", async () => {
    const run = searchPipeline<Candidate, Enriched>(
      {
        fetchCandidates: async () => makeCandidates(3),
        shallowFields: SHALLOW,
        enrich: async () => {
          throw new OpenProjectAuthenticationError();
        },
        deepFields: DEEP,
      },
      "item"
    );

    await expect(run).rejects.toThrow(OpenProjectAuthenticationError);
  });

  test("propagates rate limit errors instead of swallowing them", async () => {
    const run = searchPipeline<Candidate, Enriched>(
      {
        fetchCandidates: async () => makeCandidates(3),
        shallowFields: SHALLOW,
        enrich: async () => {
          throw new OpenProjectError("slow down", { statusCode: 429 });
        },
        deepFields: DEEP,
      },
      "item"
    );

    await expect(run).rejects.toThrow("slow down");
  });

  test("reports no degradation when every enrichment succeeds", async () => {
    const result = await searchPipeline<Candidate, Enriched>(
      {
        fetchCandidates: async () => makeCandidates(3),
        shallowFields: SHALLOW,
        enrich: async (candidate) => ({ id: candidate.id, notes: "" }),
        deepFields: DEEP,
      },
      "item"
    );

    expect(result.degraded).toBe(false);
    expect(result.enrichmentFailures).toBe(0);
  });
});
