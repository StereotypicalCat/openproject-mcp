import { describe, expect, test } from "bun:test";
import { boundedLevenshtein, scoreField, scoreToken } from "../../src/search/score.ts";
import { tokenize } from "../../src/search/tokenize.ts";

describe("boundedLevenshtein", () => {
  test("returns 0 for identical strings", () => {
    expect(boundedLevenshtein("budget", "budget", 2)).toBe(0);
  });

  test("computes small distances within budget", () => {
    expect(boundedLevenshtein("budget", "budgt", 2)).toBe(1);
    expect(boundedLevenshtein("approval", "aproval", 2)).toBe(1);
  });

  test("returns max + 1 when the distance exceeds the budget", () => {
    expect(boundedLevenshtein("cat", "dog", 1)).toBe(2);
    expect(boundedLevenshtein("meeting", "xyz", 2)).toBe(3);
  });

  test("short-circuits on length difference alone", () => {
    expect(boundedLevenshtein("a", "abcdefgh", 2)).toBe(3);
  });
});

describe("scoreToken", () => {
  test("scores an exact match at 1", () => {
    expect(scoreToken("budget", "budget")).toBe(1);
  });

  test("scores a prefix match at 0.9 when the query token is at least 3 chars", () => {
    expect(scoreToken("bud", "budget")).toBe(0.9);
  });

  test("does not prefix-match tokens shorter than 3 characters", () => {
    expect(scoreToken("bu", "budget")).toBe(0);
  });

  test("scores a containment match at 0.75 when the query token is at least 4 chars", () => {
    expect(scoreToken("prov", "approval")).toBe(0.75);
  });

  test("scores a single-typo match below an exact match but above zero", () => {
    const score = scoreToken("budgt", "budget");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  test("does NOT match unrelated short tokens", () => {
    expect(scoreToken("cat", "dog")).toBe(0);
    expect(scoreToken("red", "car")).toBe(0);
  });

  test("does not fuzzy-match tokens shorter than 3 characters", () => {
    expect(scoreToken("ab", "ac")).toBe(0);
  });

  test("matches morphological variants via a shared prefix", () => {
    // Neither token is a true prefix of the other, so these exercise the
    // shared-prefix rule rather than being intercepted by the startsWith rule.
    expect(scoreToken("decide", "decision")).toBeGreaterThan(0.5);
    expect(scoreToken("deployed", "deployment")).toBeGreaterThan(0.5);
  });

  test("does not shared-prefix-match on fewer than 4 common characters", () => {
    // "cars"/"carton" share only "car" (3 < MIN_SHARED_PREFIX) and neither is
    // a true prefix of the other, so every rule falls through to zero.
    expect(scoreToken("cars", "carton")).toBe(0);
    expect(scoreToken("bees", "beetle")).toBe(0);
  });

  test("ranks a shared-prefix match below a true prefix match", () => {
    expect(scoreToken("decide", "decision")).toBeLessThan(scoreToken("deci", "decision"));
  });
});

describe("scoreField", () => {
  test("scores a full phrase match highest", () => {
    const query = tokenize("budget approval");
    const both = scoreField(query, "Approval of the budget");
    const one = scoreField(query, "Approval of the agenda");
    expect(both.score).toBeGreaterThan(one.score);
  });

  test("coverage penalises documents matching only one query token", () => {
    const query = tokenize("hiring decision");
    const partial = scoreField(query, "Decision log");
    expect(partial.score).toBeLessThan(0.6);
  });

  test("gives a verbatim phrase a bonus over scattered tokens", () => {
    const query = tokenize("budget approval");
    const verbatim = scoreField(query, "budget approval meeting");
    const scattered = scoreField(query, "approval of the yearly budget");
    expect(verbatim.score).toBeGreaterThan(scattered.score);
  });

  test("tolerates a typo in the query", () => {
    const query = tokenize("budgt aproval");
    const result = scoreField(query, "Approval of Q3 budget");
    expect(result.score).toBeGreaterThan(0.5);
  });

  test("reports matched offsets that index into the original field text", () => {
    const field = "Approval of Q3 budget";
    const result = scoreField(tokenize("budget"), field);
    expect(result.matchedOffsets.length).toBeGreaterThan(0);
    expect(field.slice(result.matchedOffsets[0]!, result.matchedOffsets[0]! + 6)).toBe("budget");
  });

  test("returns zero for empty input", () => {
    expect(scoreField([], "anything").score).toBe(0);
    expect(scoreField(tokenize("budget"), "").score).toBe(0);
  });

  test("an all-tokens match without the phrase tops out below 1.0", () => {
    const result = scoreField(tokenize("budget approval"), "approval of the budget");
    expect(result.score).toBeCloseTo(0.85, 5);
  });

  test("only a verbatim phrase reaches 1.0", () => {
    const result = scoreField(tokenize("budget approval"), "the budget approval doc");
    expect(result.score).toBeCloseTo(1, 5);
  });
});
