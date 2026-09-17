import { describe, expect, test } from "bun:test";
import { rankRecords, type FieldSpec } from "../../src/search/rank.ts";

interface Doc {
  id: number;
  title: string;
  body?: string;
  tags?: string[];
}

const FIELDS: FieldSpec<Doc>[] = [
  { name: "title", weight: 3, extract: (d) => d.title },
  { name: "body", weight: 1, extract: (d) => d.body },
  { name: "tags", weight: 0.5, extract: (d) => d.tags },
];

const DOCS: Doc[] = [
  { id: 1, title: "Budget approval", body: "Nothing relevant here" },
  { id: 2, title: "Weekly sync", body: "We discussed the budget approval process at length" },
  { id: 3, title: "Retrospective", body: "No overlap", tags: ["budget"] },
  { id: 4, title: "Unrelated", body: "Completely different subject matter" },
];

describe("rankRecords", () => {
  test("ranks a title match above a body match", () => {
    const results = rankRecords(DOCS, "budget approval", FIELDS);
    expect(results[0]!.record.id).toBe(1);
    expect(results[1]!.record.id).toBe(2);
  });

  test("excludes records below the minimum score", () => {
    const results = rankRecords(DOCS, "budget approval", FIELDS);
    expect(results.some((r) => r.record.id === 4)).toBe(false);
  });

  test("tolerates typos", () => {
    const results = rankRecords(DOCS, "budgt aproval", FIELDS);
    expect(results[0]!.record.id).toBe(1);
  });

  test("tolerates reordered words", () => {
    const results = rankRecords(DOCS, "approval budget", FIELDS);
    expect(results[0]!.record.id).toBe(1);
  });

  test("reports which fields matched, with snippets", () => {
    const results = rankRecords(DOCS, "budget approval", FIELDS);
    const second = results.find((r) => r.record.id === 2)!;
    expect(second.matches.map((m) => m.field)).toContain("body");
    expect(second.matches[0]!.snippet).toBeDefined();
  });

  test("searches array-valued fields", () => {
    const results = rankRecords(DOCS, "budget", FIELDS);
    expect(results.some((r) => r.record.id === 3)).toBe(true);
  });

  test("breaks ties by ascending record id for determinism", () => {
    const tied: Doc[] = [
      { id: 9, title: "Budget" },
      { id: 4, title: "Budget" },
      { id: 7, title: "Budget" },
    ];
    const results = rankRecords(tied, "budget", FIELDS);
    expect(results.map((r) => r.record.id)).toEqual([4, 7, 9]);
  });

  test("applies the limit after sorting", () => {
    const results = rankRecords(DOCS, "budget", FIELDS, { limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.record.id).toBe(1);
  });

  test("exact mode matches only literal substrings", () => {
    const results = rankRecords(DOCS, "budget approval", FIELDS, { matchMode: "exact" });
    expect(results.map((r) => r.record.id).sort()).toEqual([1, 2]);
  });

  test("exact mode finds no results for a typo", () => {
    const results = rankRecords(DOCS, "budgt aproval", FIELDS, { matchMode: "exact" });
    expect(results).toHaveLength(0);
  });

  test("exact mode keeps low-weight field hits that fall under minScore", () => {
    const results = rankRecords(DOCS, "budget", FIELDS, { matchMode: "exact" });
    expect(results.some((r) => r.record.id === 3)).toBe(true);
  });

  test("a blank query returns every record unranked", () => {
    const results = rankRecords(DOCS, "   ", FIELDS);
    expect(results).toHaveLength(DOCS.length);
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  test("a query under three characters falls back to substring containment", () => {
    const results = rankRecords(DOCS, "bu", FIELDS);
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every((r) => {
        const haystack = [r.record.title, r.record.body ?? "", ...(r.record.tags ?? [])]
          .join(" ")
          .toLowerCase();
        return haystack.includes("bu");
      })
    ).toBe(true);
  });

  test("a body-only match is returned despite its low field weight", () => {
    const bodyOnly: Doc[] = [{ id: 1, title: "Unrelated", body: "the hiring freeze was agreed" }];
    const results = rankRecords(bodyOnly, "hiring freeze", FIELDS);
    expect(results).toHaveLength(1);
    expect(results[0]!.matches[0]!.field).toBe("body");
  });
});
