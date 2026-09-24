import { describe, expect, test } from "bun:test";
import { rankRecords, type FieldSpec } from "../../src/search/rank.ts";

interface Doc {
  id: number;
  title: string;
  body: string;
  people: string[];
}

const CORPUS: Doc[] = [
  {
    id: 1,
    title: "Approval of Q3 budget",
    body: "The finance team presented the quarterly figures and the board signed off.",
    people: ["Anna Müller", "Ben Carter"],
  },
  {
    id: 2,
    title: "Weekly engineering sync",
    body: "After a long discussion about staffing we reached a decision on the hiring freeze.",
    people: ["Ben Carter"],
  },
  {
    id: 3,
    title: "Design review",
    body: "Walked through the new onboarding flow mockups with the design team.",
    people: ["Chen Wu", "Dana Ortiz"],
  },
  {
    id: 4,
    title: "Infrastructure retrospective",
    body: "Root cause was an expired TLS certificate on the edge proxy.",
    people: ["Dana Ortiz"],
  },
  {
    id: 5,
    title: "Vendor negotiation",
    body: "Agreed new payment terms of net 45 with the hosting provider.",
    people: ["Anna Müller"],
  },
];

const FIELDS: FieldSpec<Doc>[] = [
  { name: "title", weight: 3, extract: (doc) => doc.title },
  { name: "body", weight: 1, extract: (doc) => doc.body },
  { name: "people", weight: 1, extract: (doc) => doc.people },
];

const CASES: Array<{ query: string; expectedId: number; why: string }> = [
  { query: "budget aproval", expectedId: 1, why: "typo in both words" },
  { query: "approval of the budget", expectedId: 1, why: "reordered with filler words" },
  { query: "Q3 budget", expectedId: 1, why: "verbatim phrase" },
  { query: "what did we decide about hiring", expectedId: 2, why: "natural-language body match" },
  { query: "hiring freeze", expectedId: 2, why: "exact body phrase" },
  { query: "staffing discussion", expectedId: 2, why: "paraphrase of body content" },
  { query: "onboarding mockups", expectedId: 3, why: "two body tokens" },
  { query: "design team", expectedId: 3, why: "title and body overlap" },
  { query: "tls certificate expired", expectedId: 4, why: "reordered body tokens" },
  { query: "certificat", expectedId: 4, why: "truncated word" },
  { query: "muller", expectedId: 1, why: "diacritic-insensitive person match; ties with doc 5 and wins on the id tie-break" },
  { query: "payment terms", expectedId: 5, why: "body phrase" },
];

describe("Search recall", () => {
  for (const { query, expectedId, why } of CASES) {
    test(`"${query}" finds document ${expectedId} (${why})`, () => {
      const results = rankRecords(CORPUS, query, FIELDS);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.record.id).toBe(expectedId);
    });
  }

  test("a query matching nothing returns no results rather than noise", () => {
    const results = rankRecords(CORPUS, "quantum chromodynamics", FIELDS);
    expect(results).toHaveLength(0);
  });

  test("results are stable across repeated identical searches", () => {
    const first = rankRecords(CORPUS, "budget", FIELDS).map((r) => r.record.id);
    const second = rankRecords(CORPUS, "budget", FIELDS).map((r) => r.record.id);
    expect(first).toEqual(second);
  });

  test("every legacy exact query still resolves in exact mode", () => {
    const results = rankRecords(CORPUS, "hiring freeze", FIELDS, { matchMode: "exact" });
    expect(results[0]!.record.id).toBe(2);
  });
});
