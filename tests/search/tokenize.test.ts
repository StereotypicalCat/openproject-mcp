import { describe, expect, test } from "bun:test";
import {
  normalizeText,
  tokenize,
  tokenizeQuery,
  tokenizeWithOffsets,
} from "../../src/search/tokenize.ts";

describe("normalizeText", () => {
  test("lowercases and strips diacritics", () => {
    expect(normalizeText("Müller")).toBe("muller");
    expect(normalizeText("Café")).toBe("cafe");
    expect(normalizeText("RÉSUMÉ")).toBe("resume");
  });

  test("leaves plain ascii untouched apart from case", () => {
    expect(normalizeText("Budget Approval")).toBe("budget approval");
  });
});

describe("tokenize", () => {
  test("splits on non-alphanumeric boundaries", () => {
    expect(tokenize("Approval of Q3 budget!")).toEqual(["approval", "of", "q3", "budget"]);
  });

  test("returns an empty array for empty or punctuation-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("---  ...")).toEqual([]);
  });

  test("preserves non-latin scripts", () => {
    expect(tokenize("Привет мир")).toEqual(["привет", "мир"]);
  });
});

describe("tokenizeQuery", () => {
  test("strips English stopwords from a natural-language query", () => {
    expect(tokenizeQuery("what did we decide about hiring")).toEqual(["decide", "hiring"]);
    expect(tokenizeQuery("approval of the budget")).toEqual(["approval", "budget"]);
  });

  test("keeps stopwords when nothing else would survive", () => {
    expect(tokenizeQuery("the who")).toEqual(["the", "who"]);
  });

  test("leaves a stopword-free query untouched", () => {
    expect(tokenizeQuery("budget approval")).toEqual(["budget", "approval"]);
  });
});

describe("tokenizeWithOffsets", () => {
  test("reports offsets into the original text, not the normalized text", () => {
    const tokens = tokenizeWithOffsets("Der Müller Bericht");
    expect(tokens.map((t) => t.value)).toEqual(["der", "muller", "bericht"]);
    expect(tokens.map((t) => t.offset)).toEqual([0, 4, 11]);
  });

  test("offsets index back into the source string correctly", () => {
    const source = "Approval of Q3 budget";
    const tokens = tokenizeWithOffsets(source);
    const budget = tokens.find((t) => t.value === "budget")!;
    expect(source.slice(budget.offset, budget.offset + 6)).toBe("budget");
  });
});
