import { describe, expect, test } from "bun:test";
import { extractSnippet } from "../../src/search/snippet.ts";

const LONG_TEXT =
  "The team met on Tuesday to review the quarterly plan. " +
  "After a long discussion about staffing, we reached a decision on the hiring freeze. " +
  "The remaining agenda items were deferred to the following week.";

describe("extractSnippet", () => {
  test("centres the window on the match rather than the start of the text", () => {
    const offset = LONG_TEXT.indexOf("hiring");
    const snippet = extractSnippet(LONG_TEXT, [offset]);
    expect(snippet).toContain("hiring");
    expect(snippet.startsWith("...")).toBe(true);
  });

  test("adds a leading ellipsis only when the window is not at the start", () => {
    const snippet = extractSnippet(LONG_TEXT, [0]);
    expect(snippet.startsWith("...")).toBe(false);
  });

  test("adds a trailing ellipsis when the text continues past the window", () => {
    const snippet = extractSnippet(LONG_TEXT, [0]);
    expect(snippet.endsWith("...")).toBe(true);
  });

  test("returns short text whole with no ellipsis", () => {
    expect(extractSnippet("Short note", [0])).toBe("Short note");
  });

  test("falls back to a head truncation when there are no offsets", () => {
    const snippet = extractSnippet(LONG_TEXT, []);
    expect(snippet.startsWith("The team met")).toBe(true);
    expect(snippet.endsWith("...")).toBe(true);
  });

  test("returns an empty string for empty text", () => {
    expect(extractSnippet("", [5])).toBe("");
  });

  test("uses the earliest offset when several are supplied", () => {
    const first = LONG_TEXT.indexOf("staffing");
    const later = LONG_TEXT.indexOf("deferred");
    const snippet = extractSnippet(LONG_TEXT, [later, first]);
    expect(snippet).toContain("staffing");
  });

  test("respects a custom maxLength", () => {
    const snippet = extractSnippet(LONG_TEXT, [0], 20);
    expect(snippet.replace(/\.\.\.$/, "").length).toBeLessThanOrEqual(20);
  });
});
