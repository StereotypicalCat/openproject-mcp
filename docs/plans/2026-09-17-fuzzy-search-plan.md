# Fuzzy Search by Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace exact substring matching with token-aware fuzzy matching as the default across every `openproject-mcp` search tool, with relevance ranking and wider content coverage.

**Architecture:** A new pure-computation unit `src/search/` (tokenize → score → rank → snippet → pipeline) with no I/O and no module-level state. Domain services declare *what* to search via `FieldSpec<T>` declarations; the search unit decides *how well* it matches. Deep content is fetched by a bounded two-phase pipeline: rank cheaply on list data, then enrich only the top 25 candidates with capped concurrency.

**Tech Stack:** Bun (>= 1.2), TypeScript strict mode, `zod` for schemas, `bun:test` with hand-rolled mock clients. No new runtime dependencies.

**Spec:** `docs/specs/2026-09-17-fuzzy-search-design.md`

## Global Constraints

- **Runtime:** Bun only. `bun test`, `bun run typecheck`, `bun add`. Never `npm`/`node`/`ts-node`/`jest`/`vitest`.
- **Zero new runtime dependencies.** The scorer is hand-rolled. Do not add `fuse.js`, `fastest-levenshtein`, or any other package.
- **TypeScript strict mode.** No `any`. Use `unknown` with type guards. Array index access needs `!` or a guard (`noUncheckedIndexedAccess` is in effect).
- **File naming:** `kebab-case`. Types/interfaces `PascalCase`. Functions/variables `camelCase`. Constants `UPPER_SNAKE_CASE`.
- **Imports:** relative with explicit `.ts` extension, matching existing code (`import { x } from "./tokenize.ts"`).
- **`verbatimModuleSyntax` is enabled.** Type-only imports MUST use `import type { ... }`. Mixing a type into a value import is a compile error. Values (`rankRecords`, `searchPipeline`) use a plain `import`; types (`FieldSpec`, `MatchMode`) use `import type`.
- **Stateless services:** never store clients or tokens in module-level mutable state. `src/search/` must hold no module-level state at all.
- **All touched tools remain `readOnly: true`.**
- **Default constants (exact values):** `DEFAULT_MIN_SCORE = 0.35`, `DEFAULT_ENRICH_LIMIT = 25`, `DEFAULT_CONCURRENCY = 8`, `PHRASE_BONUS = 0.15`, `EDIT_PENALTY = 0.6`, snippet `maxLength = 160`, snippet `contextBefore = 40`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Commit at the end of every task.
- **Branch:** `feat/fuzzy-search` (already created; the spec commit is `5dc609c`).

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/search/tokenize.ts` | Unicode normalization; splitting text into tokens with original-text offsets |
| `src/search/score.ts` | `boundedLevenshtein`, per-token scoring, per-field scoring with coverage |
| `src/search/snippet.ts` | Match-centred excerpt extraction |
| `src/search/rank.ts` | Generic record ranking over `FieldSpec<T>` declarations; exact-mode bypass |
| `src/search/pipeline.ts` | Bounded concurrency helper; two-phase shallow/deep orchestration |
| `src/search/index.ts` | Barrel export |
| `tests/search/tokenize.test.ts` | Tokenizer unit tests |
| `tests/search/score.test.ts` | Scoring unit tests including the guard cases |
| `tests/search/snippet.test.ts` | Snippet unit tests |
| `tests/search/rank.test.ts` | Ranking, weighting, tie-break, exact-mode tests |
| `tests/search/pipeline.test.ts` | Budget, backfill, degradation, fatal-error tests |
| `tests/search/recall.test.ts` | End-to-end recall suite against a fixture corpus |

**Modified:**

| File | Change |
| --- | --- |
| `src/services/meetings.ts` | `searchMeetings` rewritten onto the pipeline; `extractSnippet` removed; `MeetingSearchResult` extended |
| `src/services/wikis.ts` | `WikiPageDetail.text` added; `normalizeWikiPageDetail` retains body; `searchWikiPages` ranks |
| `src/services/work-packages.ts` | `searchWorkPackages` union strategy + deep enrichment; activities gain ranking |
| `src/tools/meetings.ts` | `matchMode` on `searchMeetingsShape`; description rewritten |
| `src/tools/wikis.ts` | `matchMode` on `searchWikiPagesShape`; description rewritten |
| `src/tools/work-packages.ts` | NEW `openproject_search_work_packages` tool; `query`/`matchMode` on activities shape |
| `tests/mcp-server.test.ts`, `tests/read-only.test.ts`, `tests/tools.test.ts` | Tool count assertions 18 → 19 |
| `docs/DECISIONS.md` | ADR-019 |
| `docs/ARCHITECTURE.md` | `src/search/` unit |
| `README.md` | Tool table: `matchMode`, `score`, `matchedFields` |
| `docs/TODO.md` | Milestone + the two known limitations |

**Dependency order:** Task 1 → 2 → 3 → 4 → 5 are strictly sequential (each imports the previous). Tasks 6, 7, 8, 9 depend on 1–5 but are independent of each other. Task 10 depends on 6–9. Task 11 depends on everything.

---

### Task 1: Tokenization

**Files:**
- Create: `src/search/tokenize.ts`
- Test: `tests/search/tokenize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeText(text: string): string`, `tokenize(text: string): string[]`, `tokenizeWithOffsets(text: string): Token[]`, `interface Token { value: string; offset: number }`.

**Why offsets matter:** NFKD normalization can change string length (the `ﬁ` ligature expands to `fi`), so offsets computed on normalized text do not reliably index the original text. `tokenizeWithOffsets` therefore scans the **original** text for token boundaries and normalizes only each token's value. Offsets returned are always original-text offsets, which is what the snippet extractor needs.

- [ ] **Step 1: Write the failing test**

Create `tests/search/tokenize.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { normalizeText, tokenize, tokenizeWithOffsets } from "../../src/search/tokenize.ts";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/tokenize.test.ts`
Expected: FAIL — module `../../src/search/tokenize.ts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/search/tokenize.ts`:

```ts
/**
 * Text normalization and tokenization for fuzzy search.
 *
 * Query text and field text must travel through an identical path; any
 * divergence between the two sides silently breaks matching, so there is
 * exactly one implementation of each operation here.
 */

export interface Token {
  /** Normalized token value. */
  value: string;
  /** Character offset of the token in the ORIGINAL (un-normalized) text. */
  offset: number;
}

const COMBINING_MARKS = /[̀-ͯ]/g;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

/**
 * Lowercases text and strips diacritics via NFKD decomposition, so that
 * "Müller" matches "muller" and "café" matches "cafe".
 */
export function normalizeText(text: string): string {
  return text.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase();
}

/**
 * Splits text into normalized tokens, each carrying its offset in the
 * original string.
 *
 * Token boundaries are found on the ORIGINAL text and normalization is
 * applied per token, because NFKD can change string length and would
 * otherwise invalidate the offsets.
 */
export function tokenizeWithOffsets(text: string): Token[] {
  const tokens: Token[] = [];
  if (!text) {
    return tokens;
  }

  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    const value = normalizeText(match[0]);
    if (value.length > 0) {
      tokens.push({ value, offset: match.index });
    }
  }

  return tokens;
}

/**
 * Splits text into normalized tokens, discarding offsets.
 */
export function tokenize(text: string): string[] {
  return tokenizeWithOffsets(text).map((token) => token.value);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/search/tokenize.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/search/tokenize.ts tests/search/tokenize.test.ts
git commit -m "feat(search): add unicode-aware tokenizer with original-text offsets"
```

---

### Task 2: Scoring Primitives

**Files:**
- Create: `src/search/score.ts`
- Test: `tests/search/score.test.ts`

**Interfaces:**
- Consumes: `normalizeText`, `tokenizeWithOffsets`, `Token` from `./tokenize.ts`.
- Produces: `boundedLevenshtein(a: string, b: string, max: number): number`, `scoreToken(queryToken: string, fieldToken: string): number`, `scoreField(queryTokens: string[], fieldText: string): FieldScore`, `interface FieldScore { score: number; matchedOffsets: number[] }`.

**Note on the sub-3-character guard:** spec §5 says queries under 3 characters fall back to substring containment. This task implements that at the *token* level too — a query token shorter than 3 characters only matches exactly. Without it, `ab` would fuzzily match `ac` at 0.7 and two-letter tokens would match nearly everything.

- [ ] **Step 1: Write the failing test**

Create `tests/search/score.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/score.test.ts`
Expected: FAIL — module `../../src/search/score.ts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/search/score.ts`:

```ts
/**
 * Fuzzy scoring primitives.
 */

import { tokenizeWithOffsets } from "./tokenize.ts";

export interface FieldScore {
  /** Aggregate field score in the range 0..1. */
  score: number;
  /** Offsets of matching tokens in the ORIGINAL field text. */
  matchedOffsets: number[];
}

/** Multiplier applied to the normalized edit distance when scoring a typo. */
const EDIT_PENALTY = 0.6;

/** Added when the full query appears verbatim in the field. */
const PHRASE_BONUS = 0.15;

/** Below this length a token only ever matches exactly. */
const MIN_FUZZY_TOKEN_LENGTH = 3;

/** Below this length a token is not eligible for containment matching. */
const MIN_CONTAINS_TOKEN_LENGTH = 4;

/**
 * Levenshtein distance with an early exit.
 *
 * Returns the true distance when it is <= max, otherwise max + 1. The
 * overwhelmingly common case is a non-match, so the row-minimum early exit
 * is what keeps scoring cheap over long documents.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) {
    return 0;
  }
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  if (a.length === 0) {
    return b.length <= max ? b.length : max + 1;
  }
  if (b.length === 0) {
    return a.length <= max ? a.length : max + 1;
  }

  let previous: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMinimum = i;

    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + substitutionCost
      );
      current[j] = value;
      if (value < rowMinimum) {
        rowMinimum = value;
      }
    }

    if (rowMinimum > max) {
      return max + 1;
    }

    const swap = previous;
    previous = current;
    current = swap;
  }

  const distance = previous[b.length]!;
  return distance <= max ? distance : max + 1;
}

/**
 * Scores a single query token against a single field token.
 *
 * Rules are applied in order and the first match wins. The length guards are
 * load-bearing: without them "cat" is edit distance 3 from "dog" and every
 * short token fuzzily matches every other short token.
 */
export function scoreToken(queryToken: string, fieldToken: string): number {
  if (queryToken === fieldToken) {
    return 1;
  }
  if (queryToken.length < MIN_FUZZY_TOKEN_LENGTH) {
    return 0;
  }
  if (fieldToken.startsWith(queryToken)) {
    return 0.9;
  }
  if (queryToken.length >= MIN_CONTAINS_TOKEN_LENGTH && fieldToken.includes(queryToken)) {
    return 0.75;
  }

  const maxDistance = queryToken.length < 6 ? 1 : 2;
  const distance = boundedLevenshtein(queryToken, fieldToken, maxDistance);
  if (distance > maxDistance) {
    return 0;
  }

  return 1 - (distance / queryToken.length) * EDIT_PENALTY;
}

/**
 * Scores a set of query tokens against one field's text.
 *
 * Aggregation is mean(best score per query token) * coverage, where coverage
 * is the fraction of query tokens that matched anything. Coverage is what
 * stops a two-word query from ranking a document that matched only the
 * common word.
 */
export function scoreField(queryTokens: string[], fieldText: string): FieldScore {
  const empty: FieldScore = { score: 0, matchedOffsets: [] };

  if (queryTokens.length === 0 || !fieldText) {
    return empty;
  }

  const fieldTokens = tokenizeWithOffsets(fieldText);
  if (fieldTokens.length === 0) {
    return empty;
  }

  let total = 0;
  let matchedCount = 0;
  const matchedOffsets: number[] = [];

  for (const queryToken of queryTokens) {
    let best = 0;
    let bestOffset = -1;

    for (const fieldToken of fieldTokens) {
      const score = scoreToken(queryToken, fieldToken.value);
      if (score > best) {
        best = score;
        bestOffset = fieldToken.offset;
        if (best === 1) {
          break;
        }
      }
    }

    total += best;
    if (best > 0) {
      matchedCount++;
      if (bestOffset >= 0) {
        matchedOffsets.push(bestOffset);
      }
    }
  }

  if (matchedCount === 0) {
    return empty;
  }

  const coverage = matchedCount / queryTokens.length;
  let score = (total / queryTokens.length) * coverage;

  // Phrase bonus, compared over joined token values so that punctuation
  // between words does not defeat the check.
  const phrase = queryTokens.join(" ");
  const joinedField = fieldTokens.map((token) => token.value).join(" ");
  if (joinedField.includes(phrase)) {
    score += PHRASE_BONUS;
  }

  return {
    score: Math.min(1, score),
    matchedOffsets: matchedOffsets.sort((a, b) => a - b),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/search/score.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/search/score.ts tests/search/score.test.ts
git commit -m "feat(search): add bounded levenshtein and coverage-weighted field scoring"
```

---

### Task 3: Snippet Extraction

**Files:**
- Create: `src/search/snippet.ts`
- Test: `tests/search/snippet.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `extractSnippet(text: string, matchedOffsets: number[], maxLength?: number): string`.

**Why this replaces the existing helper:** `src/services/meetings.ts:250` currently locates the excerpt with `text.indexOf(query)` and truncates from character 0 when that fails. Under fuzzy matching `indexOf` fails on essentially every hit, so snippets would silently degrade to "the first 160 characters" — worse than today. This version centres the window on offsets the scorer already computed.

- [ ] **Step 1: Write the failing test**

Create `tests/search/snippet.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/snippet.test.ts`
Expected: FAIL — module `../../src/search/snippet.ts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/search/snippet.ts`:

```ts
/**
 * Match-centred excerpt extraction for search results.
 */

const DEFAULT_MAX_LENGTH = 160;
const CONTEXT_BEFORE = 40;

/**
 * Extracts an excerpt of `text` centred on the earliest match offset.
 *
 * `matchedOffsets` are offsets into the ORIGINAL text, as produced by
 * `scoreField`. When no offsets are supplied the excerpt falls back to a
 * head truncation.
 */
export function extractSnippet(
  text: string,
  matchedOffsets: number[],
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text.trim();
  }

  let start = 0;
  if (matchedOffsets.length > 0) {
    const earliest = Math.min(...matchedOffsets);
    start = Math.max(0, Math.min(earliest - CONTEXT_BEFORE, text.length - maxLength));
  }

  const end = Math.min(text.length, start + maxLength);
  let snippet = text.slice(start, end).trim();

  if (start > 0) {
    snippet = `...${snippet}`;
  }
  if (end < text.length) {
    snippet = `${snippet}...`;
  }

  return snippet;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/search/snippet.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/search/snippet.ts tests/search/snippet.test.ts
git commit -m "feat(search): add match-centred snippet extraction"
```

---

### Task 4: Generic Record Ranking

**Files:**
- Create: `src/search/rank.ts`
- Test: `tests/search/rank.test.ts`

**Interfaces:**
- Consumes: `normalizeText`, `tokenize` from `./tokenize.ts`; `scoreField`, `FieldScore` from `./score.ts`; `extractSnippet` from `./snippet.ts`.
- Produces:
  - `type MatchMode = "fuzzy" | "exact"`
  - `interface FieldSpec<T> { name: string; weight: number; extract: (record: T) => string | string[] | undefined }`
  - `interface FieldMatch { field: string; score: number; snippet?: string }`
  - `interface Ranked<T> { record: T; score: number; matches: FieldMatch[] }`
  - `interface RankOptions<T> { minScore?: number; limit?: number; matchMode?: MatchMode; idOf?: (record: T) => number }`
  - `rankRecords<T>(records: T[], query: string, fields: FieldSpec<T>[], opts?: RankOptions<T>): Ranked<T>[]`
  - `const DEFAULT_MIN_SCORE = 0.35`

**Critical detail — the exact-mode threshold.** In exact mode a containment hit scores 1, but the record score is weighted: a hit on a weight-0.5 field where the max weight is 3.0 yields `1 * 0.5 / 3.0 = 0.167`, which is *below* `DEFAULT_MIN_SCORE` and would be silently dropped. Exact mode must therefore use a threshold of "greater than zero", not `minScore`. Getting this wrong breaks backward compatibility in a way the regression suite in Task 6 will catch.

- [ ] **Step 1: Write the failing test**

Create `tests/search/rank.test.ts`:

```ts
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
    expect(results.every((r) => r.record.title.toLowerCase().includes("bu") || (r.record.body ?? "").toLowerCase().includes("bu"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/rank.test.ts`
Expected: FAIL — module `../../src/search/rank.ts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/search/rank.ts`:

```ts
/**
 * Generic relevance ranking over record collections.
 *
 * Services declare WHAT to search via FieldSpec declarations; this module
 * decides HOW WELL each record matches.
 */

import { normalizeText, tokenize } from "./tokenize.ts";
import { scoreField, type FieldScore } from "./score.ts";
import { extractSnippet } from "./snippet.ts";

export type MatchMode = "fuzzy" | "exact";

export interface FieldSpec<T> {
  /** Field name reported back in FieldMatch.field. */
  name: string;
  /** Relative importance; scores are normalized by the highest declared weight. */
  weight: number;
  /** Pulls the searchable text out of a record. */
  extract: (record: T) => string | string[] | undefined;
}

export interface FieldMatch {
  field: string;
  score: number;
  snippet?: string;
}

export interface Ranked<T> {
  record: T;
  /** 0..1, the best weighted field score. */
  score: number;
  /** Only fields that scored above zero, highest first. */
  matches: FieldMatch[];
}

export interface RankOptions<T = unknown> {
  minScore?: number;
  limit?: number;
  matchMode?: MatchMode;
  /** Used for deterministic tie-breaking. Defaults to reading `record.id`. */
  idOf?: (record: T) => number;
}

export const DEFAULT_MIN_SCORE = 0.35;

/** Below this query length, edit distance is meaningless (spec section 5). */
const MIN_FUZZY_QUERY_LENGTH = 3;

function defaultIdOf(record: unknown): number {
  return (record as { id?: number })?.id ?? 0;
}

function fieldTexts<T>(record: T, spec: FieldSpec<T>): string[] {
  const raw = spec.extract(record);
  if (raw === undefined || raw === null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
  }
  return raw.length > 0 ? [raw] : [];
}

/**
 * Case-insensitive substring containment, reproducing the pre-fuzzy behaviour
 * byte for byte.
 */
function scoreExact(query: string, text: string): FieldScore {
  const haystack = normalizeText(text);
  const needle = normalizeText(query);
  if (needle.length === 0) {
    return { score: 0, matchedOffsets: [] };
  }
  const index = haystack.indexOf(needle);
  return index === -1 ? { score: 0, matchedOffsets: [] } : { score: 1, matchedOffsets: [index] };
}

/**
 * Ranks records against a query using the supplied field declarations.
 *
 * Record score is the best weighted field score:
 *   recordScore = max over fields of (fieldScore * weight) / maxDeclaredWeight
 *
 * Normalizing by the maximum DECLARED weight (not the best matching weight)
 * means a hit on a low-weight field yields a proportionally lower record
 * score rather than being rescaled up to 1.
 */
export function rankRecords<T>(
  records: T[],
  query: string,
  fields: FieldSpec<T>[],
  opts?: RankOptions<T>
): Ranked<T>[] {
  const matchMode = opts?.matchMode ?? "fuzzy";
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
  const idOf = opts?.idOf ?? defaultIdOf;

  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return records.map((record) => ({ record, score: 0, matches: [] }));
  }

  const queryTokens = tokenize(trimmedQuery);
  const useExact =
    matchMode === "exact" ||
    trimmedQuery.length < MIN_FUZZY_QUERY_LENGTH ||
    queryTokens.length === 0;

  // Exact mode must not apply minScore: a containment hit on a low-weight
  // field legitimately scores below it, and dropping those would break
  // backward compatibility.
  const threshold = useExact ? Number.EPSILON : minScore;

  const maxWeight = fields.reduce((highest, field) => Math.max(highest, field.weight), 0) || 1;

  const ranked: Ranked<T>[] = [];

  for (const record of records) {
    const matches: FieldMatch[] = [];
    let bestWeighted = 0;

    for (const spec of fields) {
      let bestScore: FieldScore = { score: 0, matchedOffsets: [] };
      let bestText = "";

      for (const text of fieldTexts(record, spec)) {
        const result = useExact ? scoreExact(trimmedQuery, text) : scoreField(queryTokens, text);
        if (result.score > bestScore.score) {
          bestScore = result;
          bestText = text;
        }
      }

      if (bestScore.score > 0) {
        matches.push({
          field: spec.name,
          score: Number(bestScore.score.toFixed(2)),
          snippet: extractSnippet(bestText, bestScore.matchedOffsets) || undefined,
        });

        const weighted = (bestScore.score * spec.weight) / maxWeight;
        if (weighted > bestWeighted) {
          bestWeighted = weighted;
        }
      }
    }

    if (bestWeighted >= threshold) {
      matches.sort((a, b) => b.score - a.score);
      ranked.push({ record, score: Number(bestWeighted.toFixed(2)), matches });
    }
  }

  ranked.sort((a, b) => b.score - a.score || idOf(a.record) - idOf(b.record));

  return opts?.limit !== undefined && opts.limit > 0 ? ranked.slice(0, opts.limit) : ranked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/search/rank.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/search/rank.ts tests/search/rank.test.ts
git commit -m "feat(search): add generic field-spec record ranking with exact-mode bypass"
```

---

### Task 5: Two-Phase Pipeline

**Files:**
- Create: `src/search/pipeline.ts`
- Create: `src/search/index.ts`
- Test: `tests/search/pipeline.test.ts`

**Interfaces:**
- Consumes: `rankRecords`, `FieldSpec`, `FieldMatch`, `RankOptions` from `./rank.ts`; `OpenProjectAuthenticationError` from `../client/api-client.ts`.
- Produces:
  - `mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`
  - `isFatalSearchError(error: unknown): boolean`
  - `interface PipelineSpec<TShallow, TDeep>` (fields listed in the code below)
  - `interface PipelineEntry<TShallow, TDeep> { record: TShallow; score: number; matches: FieldMatch[]; deep?: TDeep }`
  - `interface PipelineResult<TShallow, TDeep> { ranked: PipelineEntry<TShallow, TDeep>[]; degraded: boolean; enrichmentFailures: number }`
  - `searchPipeline<TShallow, TDeep>(spec, query, opts?): Promise<PipelineResult<TShallow, TDeep>>`
  - `const DEFAULT_ENRICH_LIMIT = 25`, `const DEFAULT_CONCURRENCY = 8`

- [ ] **Step 1: Write the failing test**

Create `tests/search/pipeline.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/pipeline.test.ts`
Expected: FAIL — module `../../src/search/pipeline.ts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/search/pipeline.ts`:

```ts
/**
 * Two-phase search orchestration.
 *
 * Phase 1 ranks candidates on data the list endpoint already returned, at no
 * additional API cost. Phase 2 enriches a bounded subset with deep content
 * and re-ranks. Final score is max(shallow, deep) so that a dead-on title
 * match is never diluted by an unrelated body.
 */

import { OpenProjectAuthenticationError } from "../client/api-client.ts";
import { rankRecords, type FieldMatch, type FieldSpec, type RankOptions } from "./rank.ts";

export const DEFAULT_ENRICH_LIMIT = 25;
export const DEFAULT_CONCURRENCY = 8;

export interface PipelineSpec<TShallow, TDeep> {
  /** Fetches the candidate window. */
  fetchCandidates: () => Promise<TShallow[]>;
  /** Fields available without any additional API call. */
  shallowFields: FieldSpec<TShallow>[];
  /** Fetches deep content for one candidate. */
  enrich: (candidate: TShallow) => Promise<TDeep>;
  /** Fields available only after enrichment. */
  deepFields: FieldSpec<TDeep>[];
  enrichLimit?: number;
  concurrency?: number;
  /** Orders the recency backfill. Omitted means "keep API order". */
  recencyOf?: (candidate: TShallow) => string | number;
  idOf?: (candidate: TShallow) => number;
}

export interface PipelineEntry<TShallow, TDeep> {
  record: TShallow;
  score: number;
  matches: FieldMatch[];
  deep?: TDeep;
}

export interface PipelineResult<TShallow, TDeep> {
  ranked: PipelineEntry<TShallow, TDeep>[];
  /** True when at least one enrichment failed non-fatally. */
  degraded: boolean;
  enrichmentFailures: number;
}

/**
 * True for errors that must abort the whole search rather than degrade one
 * record: an expired token must not be reported to the model as "no results".
 */
export function isFatalSearchError(error: unknown): boolean {
  if (error instanceof OpenProjectAuthenticationError) {
    return true;
  }
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return statusCode === 401 || statusCode === 403 || statusCode === 429;
}

/**
 * Maps over items with a bounded number of in-flight operations, preserving
 * input order in the results.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}

function recencyValue<T>(
  recencyOf: ((candidate: T) => string | number) | undefined,
  candidate: T
): number {
  if (!recencyOf) {
    return 0;
  }
  const value = recencyOf(candidate);
  if (typeof value === "number") {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function searchPipeline<TShallow, TDeep>(
  spec: PipelineSpec<TShallow, TDeep>,
  query: string,
  opts?: RankOptions<TShallow>
): Promise<PipelineResult<TShallow, TDeep>> {
  const candidates = await spec.fetchCandidates();
  const enrichLimit = spec.enrichLimit ?? DEFAULT_ENRICH_LIMIT;
  const concurrency = spec.concurrency ?? DEFAULT_CONCURRENCY;
  const idOf = spec.idOf ?? ((candidate: TShallow) => (candidate as { id?: number })?.id ?? 0);

  // Phase 1: rank on data we already have. No limit here — the limit applies
  // to the final merged result, not the intermediate ranking.
  const shallowRanked = rankRecords(candidates, query, spec.shallowFields, {
    ...opts,
    idOf,
    limit: undefined,
  });

  const entries = new Map<number, PipelineEntry<TShallow, TDeep>>();
  for (const ranked of shallowRanked) {
    entries.set(idOf(ranked.record), {
      record: ranked.record,
      score: ranked.score,
      matches: ranked.matches,
    });
  }

  // Enrichment set: top N by shallow score, backfilled by recency. The
  // backfill exists because a record whose only match is deep scores zero
  // shallowly and would otherwise never be enriched, and so never found.
  const selected = shallowRanked.slice(0, enrichLimit).map((ranked) => ranked.record);
  if (selected.length < enrichLimit) {
    const alreadySelected = new Set(selected.map(idOf));
    const backfill = candidates
      .filter((candidate) => !alreadySelected.has(idOf(candidate)))
      .sort(
        (a, b) => recencyValue(spec.recencyOf, b) - recencyValue(spec.recencyOf, a)
      );

    for (const candidate of backfill) {
      if (selected.length >= enrichLimit) {
        break;
      }
      selected.push(candidate);
    }
  }

  // Phase 2: bounded enrichment.
  let enrichmentFailures = 0;
  const enriched = await mapWithConcurrency(selected, concurrency, async (candidate) => {
    try {
      return { candidate, deep: await spec.enrich(candidate) };
    } catch (error: unknown) {
      if (isFatalSearchError(error)) {
        throw error;
      }
      enrichmentFailures++;
      return { candidate, deep: undefined };
    }
  });

  interface Pair {
    candidate: TShallow;
    deep: TDeep;
  }

  const pairs: Pair[] = enriched.filter(
    (entry): entry is Pair => entry.deep !== undefined
  );

  // Attach deep content to every enriched entry, matched or not, so callers
  // can reuse it without re-fetching.
  for (const pair of pairs) {
    const existing = entries.get(idOf(pair.candidate));
    if (existing) {
      existing.deep = pair.deep;
    }
  }

  const pairFields: FieldSpec<Pair>[] = spec.deepFields.map((field) => ({
    name: field.name,
    weight: field.weight,
    extract: (pair: Pair) => field.extract(pair.deep),
  }));

  const deepRanked = rankRecords(pairs, query, pairFields, {
    ...opts,
    idOf: (pair: Pair) => idOf(pair.candidate),
    limit: undefined,
  });

  for (const ranked of deepRanked) {
    const id = idOf(ranked.record.candidate);
    const existing = entries.get(id);

    if (existing) {
      // max(shallow, deep), never a sum.
      if (ranked.score > existing.score) {
        existing.score = ranked.score;
      }
      existing.matches = [...existing.matches, ...ranked.matches].sort(
        (a, b) => b.score - a.score
      );
      existing.deep = ranked.record.deep;
    } else {
      entries.set(id, {
        record: ranked.record.candidate,
        score: ranked.score,
        matches: ranked.matches,
        deep: ranked.record.deep,
      });
    }
  }

  const ranked = [...entries.values()].sort(
    (a, b) => b.score - a.score || idOf(a.record) - idOf(b.record)
  );

  const limited =
    opts?.limit !== undefined && opts.limit > 0 ? ranked.slice(0, opts.limit) : ranked;

  return {
    ranked: limited,
    degraded: enrichmentFailures > 0,
    enrichmentFailures,
  };
}
```

Create `src/search/index.ts`:

```ts
/**
 * Fuzzy search unit barrel export.
 */

export { normalizeText, tokenize, tokenizeWithOffsets, type Token } from "./tokenize.ts";
export { boundedLevenshtein, scoreToken, scoreField, type FieldScore } from "./score.ts";
export { extractSnippet } from "./snippet.ts";
export {
  rankRecords,
  DEFAULT_MIN_SCORE,
  type MatchMode,
  type FieldSpec,
  type FieldMatch,
  type Ranked,
  type RankOptions,
} from "./rank.ts";
export {
  searchPipeline,
  mapWithConcurrency,
  isFatalSearchError,
  DEFAULT_ENRICH_LIMIT,
  DEFAULT_CONCURRENCY,
  type PipelineSpec,
  type PipelineEntry,
  type PipelineResult,
} from "./pipeline.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/search/pipeline.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole search suite and typecheck**

Run: `bun test tests/search/ && bun run typecheck`
Expected: all search tests pass; typecheck silent.

- [ ] **Step 6: Commit**

```bash
git add src/search/pipeline.ts src/search/index.ts tests/search/pipeline.test.ts
git commit -m "feat(search): add two-phase pipeline with bounded concurrency and recency backfill"
```

---

### Task 6: Meetings Integration

**Files:**
- Modify: `src/services/meetings.ts` (remove `extractSnippet` at 250-264; rewrite `searchMeetings` at 367-490; extend `MeetingSearchResult` at 49-57)
- Modify: `src/tools/meetings.ts` (`searchMeetingsShape` at 94-119; `searchMeetingsTool` description at 161-170)
- Test: `tests/meetings.test.ts` (extend)

**Interfaces:**
- Consumes: `searchPipeline`, `PipelineResult` from `../search/pipeline.ts`; `rankRecords`, `FieldSpec`, `MatchMode` from `../search/rank.ts`.
- Produces: `searchMeetings(params: SearchMeetingsParams, client?: OpenProjectClient): Promise<MeetingSearchPage>` where `SearchMeetingsParams` adds `matchMode?: MatchMode` to the existing shape, and `MeetingSearchPage` is `PaginatedResult<MeetingSearchResult> & { degraded: boolean; enrichmentFailures: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/meetings.test.ts`:

```ts
describe("Meetings Fuzzy Search", () => {
  function meetingFixtureClient() {
    return {
      get: async (path: string) => {
        if (path.startsWith("/api/v3/meetings?") || path === "/api/v3/meetings") {
          return {
            _type: "Collection",
            total: 2,
            count: 2,
            pageSize: 50,
            offset: 1,
            _embedded: {
              elements: [
                {
                  _type: "Meeting",
                  id: 1,
                  title: "Approval of Q3 budget",
                  state: "open",
                  startTime: "2026-09-08T00:00:00Z",
                  endTime: "2026-09-08T01:00:00Z",
                  location: "Room A",
                  _links: {
                    project: { href: "/api/v3/projects/1", title: "Demo project" },
                    author: { href: "/api/v3/users/4", title: "Müller" },
                  },
                },
                {
                  _type: "Meeting",
                  id: 2,
                  title: "Weekly sync",
                  state: "open",
                  startTime: "2026-09-09T00:00:00Z",
                  endTime: "2026-09-09T01:00:00Z",
                  _links: {
                    project: { href: "/api/v3/projects/1", title: "Demo project" },
                  },
                },
              ],
            },
          };
        }
        if (path === "/api/v3/meetings/1/agenda_items") {
          return { _type: "Collection", _embedded: { elements: [] } };
        }
        if (path === "/api/v3/meetings/2/agenda_items") {
          return {
            _type: "Collection",
            _embedded: {
              elements: [
                {
                  _type: "MeetingAgendaItem",
                  id: 20,
                  title: "Staffing",
                  notes: { raw: "We agreed on the hiring freeze until January." },
                  position: 1,
                },
              ],
            },
          };
        }
        return { _type: "Collection", _embedded: { elements: [] } };
      },
    } as unknown as OpenProjectClient;
  }

  test("finds a meeting despite a typo in the query", async () => {
    const result = await searchMeetings({ query: "budgt aproval" }, meetingFixtureClient());
    expect(result.elements[0]!.meeting.id).toBe(1);
    expect(result.elements[0]!.score).toBeGreaterThan(0);
  });

  test("finds a meeting with reordered query words", async () => {
    const result = await searchMeetings({ query: "budget approval" }, meetingFixtureClient());
    expect(result.elements[0]!.meeting.id).toBe(1);
  });

  test("finds a meeting by agenda item notes only", async () => {
    const result = await searchMeetings({ query: "hiring freeze" }, meetingFixtureClient());
    expect(result.elements[0]!.meeting.id).toBe(2);
    expect(result.elements[0]!.matchType).toBe("agenda_item");
    expect(result.elements[0]!.matchedAgendaItems?.[0]!.snippet).toContain("hiring freeze");
  });

  test("matches an author name with diacritics", async () => {
    const result = await searchMeetings({ query: "muller" }, meetingFixtureClient());
    expect(result.elements.some((e) => e.meeting.id === 1)).toBe(true);
  });

  test("exact mode finds nothing for a typo", async () => {
    const result = await searchMeetings(
      { query: "budgt aproval", matchMode: "exact" },
      meetingFixtureClient()
    );
    expect(result.elements).toHaveLength(0);
  });

  test("exact mode still finds a literal substring", async () => {
    const result = await searchMeetings(
      { query: "Q3 budget", matchMode: "exact" },
      meetingFixtureClient()
    );
    expect(result.elements[0]!.meeting.id).toBe(1);
  });

  test("reports degradation rather than silently returning fewer results", async () => {
    const client = {
      get: async (path: string) => {
        if (path.includes("agenda_items")) {
          throw new OpenProjectError("server error", { statusCode: 500 });
        }
        return meetingFixtureClient().get(path);
      },
    } as unknown as OpenProjectClient;

    const result = await searchMeetings({ query: "budget" }, client);
    expect(result.degraded).toBe(true);
    expect(result.enrichmentFailures).toBeGreaterThan(0);
  });

  test("propagates an auth failure instead of reporting no results", async () => {
    const client = {
      get: async (path: string) => {
        if (path.includes("agenda_items")) {
          throw new OpenProjectAuthenticationError();
        }
        return meetingFixtureClient().get(path);
      },
    } as unknown as OpenProjectClient;

    await expect(searchMeetings({ query: "budget" }, client)).rejects.toThrow(
      OpenProjectAuthenticationError
    );
  });
});
```

Add the imports this block needs at the top of `tests/meetings.test.ts`:

```ts
import {
  OpenProjectAuthenticationError,
  OpenProjectError,
} from "../src/client/api-client.ts";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/meetings.test.ts`
Expected: FAIL — `matchMode` is not accepted, `score` / `degraded` are undefined.

- [ ] **Step 3: Extend the result type**

In `src/services/meetings.ts`, replace the `MeetingSearchResult` interface (lines 49-57) with:

```ts
export interface MeetingSearchResult {
  meeting: MeetingSummary;
  matchType: "title" | "location" | "agenda_item" | "participant" | "project";
  matchedAgendaItems?: Array<{
    id: number;
    title: string;
    snippet?: string;
  }>;
  /** Relevance score in the range 0..1. */
  score: number;
  /** Names of the fields that matched, highest scoring first. */
  matchedFields: string[];
}

export interface MeetingSearchPage extends PaginatedResult<MeetingSearchResult> {
  /** True when some deep content could not be read. */
  degraded: boolean;
  enrichmentFailures: number;
}

export interface SearchMeetingsParams {
  query: string;
  projectId?: string | number;
  offset?: number;
  pageSize?: number;
  matchMode?: MatchMode;
}
```

- [ ] **Step 4: Delete the old snippet helper**

Remove `extractSnippet` entirely from `src/services/meetings.ts` (lines 250-264). It is replaced by `src/search/snippet.ts`, which the ranker calls internally.

- [ ] **Step 5: Rewrite `searchMeetings`**

Replace the whole `searchMeetings` function in `src/services/meetings.ts` with:

```ts
/**
 * Deep searches meetings across titles, locations, agenda items,
 * participants, and project names using fuzzy matching.
 */
export async function searchMeetings(
  params: SearchMeetingsParams,
  client?: OpenProjectClient
): Promise<MeetingSearchPage> {
  const opClient = resolveClient(client);
  const matchMode = params.matchMode ?? "fuzzy";

  const MAX_CANDIDATES = 250;
  const CANDIDATE_BATCH_SIZE = 100;

  const fetchCandidates = async (): Promise<MeetingSummary[]> => {
    const collected: MeetingSummary[] = [];
    let offset = 1;

    while (collected.length < MAX_CANDIDATES) {
      const page = await listMeetings(
        { projectId: params.projectId, offset, pageSize: CANDIDATE_BATCH_SIZE },
        opClient
      );

      if (page.elements.length === 0) {
        break;
      }
      collected.push(...page.elements);

      if (collected.length >= page.total || page.elements.length < CANDIDATE_BATCH_SIZE) {
        break;
      }
      offset += 1;
    }

    return collected.slice(0, MAX_CANDIDATES);
  };

  const shallowFields: FieldSpec<MeetingSummary>[] = [
    { name: "title", weight: 3, extract: (m) => m.title },
    { name: "location", weight: 1, extract: (m) => m.location },
    { name: "project", weight: 0.5, extract: (m) => m.project.name },
    { name: "author", weight: 0.5, extract: (m) => m.author?.name },
  ];

  const deepFields: FieldSpec<MeetingDeepContent>[] = [
    { name: "agenda_item", weight: 2, extract: (d) => d.agendaItems.map((i) => i.title) },
    {
      name: "agenda_notes",
      weight: 1.5,
      extract: (d) => d.agendaItems.map((i) => i.notes ?? "").filter((n) => n.length > 0),
    },
    {
      name: "outcome_notes",
      weight: 1.5,
      extract: (d) => d.agendaItems.flatMap((i) => i.outcomes.map((o) => o.notes)),
    },
    { name: "participant", weight: 1, extract: (d) => d.participants.map((p) => p.name) },
  ];

  const result = await searchPipeline<MeetingSummary, MeetingDeepContent>(
    {
      fetchCandidates,
      shallowFields,
      enrich: (meeting) => fetchMeetingDeepContent(meeting.id, opClient),
      deepFields,
      recencyOf: (meeting) => meeting.startTime,
      idOf: (meeting) => meeting.id,
    },
    params.query,
    { matchMode }
  );

  const all: MeetingSearchResult[] = result.ranked.map((entry) => {
    const matchedFields = entry.matches.map((match) => match.field);
    const matchedAgendaItems = collectMatchedAgendaItems(entry.deep, params.query, matchMode);

    return {
      meeting: entry.record,
      matchType: resolveMatchType(matchedFields),
      matchedAgendaItems: matchedAgendaItems.length > 0 ? matchedAgendaItems : undefined,
      score: entry.score,
      matchedFields,
    };
  });

  const offset = params.offset ?? 1;
  const pageSize = params.pageSize ?? 20;
  const startIndex = Math.max(0, offset - 1);
  const paged = all.slice(startIndex, startIndex + pageSize);

  return {
    total: all.length,
    count: paged.length,
    pageSize,
    offset,
    elements: paged,
    items: paged,
    degraded: result.degraded,
    enrichmentFailures: result.enrichmentFailures,
  };
}
```

Add these supporting pieces above `searchMeetings` in the same file:

```ts
interface MeetingDeepContent {
  id: number;
  agendaItems: AgendaItem[];
  participants: Array<{ id: number; name: string }>;
}

/**
 * Fetches agenda items and participants for one meeting.
 */
async function fetchMeetingDeepContent(
  meetingId: number,
  client: OpenProjectClient
): Promise<MeetingDeepContent> {
  const [agendaResponse, detail] = await Promise.all([
    client.get<HalCollection<Record<string, unknown>>>(
      `/api/v3/meetings/${meetingId}/agenda_items`
    ),
    client.get<HalResource>(`/api/v3/meetings/${meetingId}`),
  ]);

  const rawItems = agendaResponse?._embedded?.elements ?? [];
  const meetingDetail = normalizeMeetingDetail(detail);

  return {
    id: meetingId,
    agendaItems: rawItems.map(normalizeAgendaItem),
    participants: meetingDetail.participants,
  };
}

/**
 * Maps matched field names onto the legacy matchType discriminator, in
 * priority order.
 */
function resolveMatchType(matchedFields: string[]): MeetingSearchResult["matchType"] {
  if (matchedFields.includes("title")) return "title";
  if (matchedFields.includes("location")) return "location";
  if (
    matchedFields.includes("agenda_item") ||
    matchedFields.includes("agenda_notes") ||
    matchedFields.includes("outcome_notes")
  ) {
    return "agenda_item";
  }
  if (matchedFields.includes("participant")) return "participant";
  return "project";
}

/**
 * Ranks a meeting's agenda items against the query directly.
 *
 * Do NOT try to work out which item matched by searching the meeting-level
 * snippet: snippets are trimmed and ellipsized, so the original text is not
 * recoverable from them. Ranking the items themselves gives exact per-item
 * scores and snippets for free.
 */
function collectMatchedAgendaItems(
  deep: MeetingDeepContent | undefined,
  query: string,
  matchMode: MatchMode
): Array<{ id: number; title: string; snippet?: string }> {
  if (!deep || deep.agendaItems.length === 0) {
    return [];
  }

  const fields: FieldSpec<AgendaItem>[] = [
    { name: "title", weight: 2, extract: (item) => item.title },
    { name: "notes", weight: 1.5, extract: (item) => item.notes },
    {
      name: "outcomes",
      weight: 1.5,
      extract: (item) => item.outcomes.map((outcome) => outcome.notes),
    },
  ];

  return rankRecords(deep.agendaItems, query, fields, { matchMode }).map((entry) => ({
    id: entry.record.id,
    title: entry.record.title,
    snippet: entry.matches[0]?.snippet,
  }));
}
```

Add to the imports at the top of `src/services/meetings.ts`:

```ts
import { searchPipeline } from "../search/pipeline.ts";
import { rankRecords } from "../search/rank.ts";
import type { FieldSpec, MatchMode } from "../search/rank.ts";
```

- [ ] **Step 6: Update the tool schema and description**

In `src/tools/meetings.ts`, add to `searchMeetingsShape`:

```ts
  matchMode: z
    .enum(["fuzzy", "exact"])
    .optional()
    .default("fuzzy")
    .describe(
      "Matching strategy. 'fuzzy' (default) tolerates typos, word reordering, and " +
        "partial words. Use 'exact' only for literal strings you know verbatim."
    ),
```

and change the `query` description to:

```ts
    .describe(
      "Search keywords. Natural-language phrasing works; matched against meeting " +
        "titles, locations, project and author names, agenda item titles and notes, " +
        "meeting outcomes, and participant names."
    ),
```

and replace the `searchMeetingsTool` description with:

```ts
  description:
    "Search meetings and agenda items. Accepts natural-language phrasing and " +
    "tolerates typos and reordered words. Returns results ranked by relevance " +
    "with matching excerpts.",
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test tests/meetings.test.ts`
Expected: PASS, including the pre-existing meeting tests.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/services/meetings.ts src/tools/meetings.ts tests/meetings.test.ts
git commit -m "feat(meetings): fuzzy-rank meeting search over agenda, participants, and project"
```

---

### Task 7: Wiki Page Integration

**Files:**
- Modify: `src/services/wikis.ts` (`WikiPageDetail` at 22-27; `normalizeWikiPageDetail` at 100-129; `SearchWikiPagesParams` at 59-64; `searchWikiPages` at 255-387)
- Modify: `src/tools/wikis.ts` (`searchWikiPagesShape` at 45-67)
- Test: `tests/wikis.test.ts` (extend)

**Interfaces:**
- Consumes: `rankRecords`, `FieldSpec`, `MatchMode` from `../search/rank.ts`; `extractRawText` from `../client/hal-parser.ts`.
- Produces: `searchWikiPages(params?: SearchWikiPagesParams, client?: OpenProjectClient): Promise<WikiPageSearchResult[]>` where `WikiPageSearchResult = WikiPageSummary & { score: number; snippet?: string; matchedFields: string[] }`.

**No pipeline here:** the discovery cache already holds full page details locally, so both phases collapse into a single in-memory ranking pass.

- [ ] **Step 1: Write the failing tests**

Append to `tests/wikis.test.ts`:

```ts
describe("Wiki Fuzzy Search", () => {
  function wikiFixtureClient() {
    const pages: Record<string, unknown> = {
      "/api/v3/wiki_pages/1": {
        _type: "WikiPage",
        id: 1,
        title: "Onboarding Guide",
        text: { raw: "New engineers should request VPN access on their first day." },
        _links: { project: { href: "/api/v3/projects/1", title: "Demo project" } },
      },
      "/api/v3/wiki_pages/2": {
        _type: "WikiPage",
        id: 2,
        title: "Deployment Runbook",
        text: { raw: "Roll back with the previous image tag if smoke tests fail." },
        _links: { project: { href: "/api/v3/projects/1", title: "Demo project" } },
      },
    };

    return {
      getCacheKey: () => `test-${Math.random()}`,
      baseUrl: "http://localhost",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", _embedded: { elements: [] } };
        }
        if (path.endsWith("/attachments")) {
          return { _type: "Collection", _embedded: { elements: [] } };
        }
        if (pages[path]) {
          return pages[path];
        }
        throw new OpenProjectError("not found", { statusCode: 404 });
      },
    } as unknown as OpenProjectClient;
  }

  test("retains page body text when normalizing", async () => {
    const page = await getWikiPage(1, wikiFixtureClient());
    expect(page.text).toContain("VPN access");
  });

  test("finds a page by body text, not just title", async () => {
    const results = await searchWikiPages({ query: "vpn access" }, wikiFixtureClient());
    expect(results[0]!.id).toBe(1);
    expect(results[0]!.matchedFields).toContain("text");
  });

  test("ranks a title match above a body match", async () => {
    const results = await searchWikiPages({ query: "deployment" }, wikiFixtureClient());
    expect(results[0]!.id).toBe(2);
  });

  test("tolerates a typo in the query", async () => {
    const results = await searchWikiPages({ query: "onboardng" }, wikiFixtureClient());
    expect(results[0]!.id).toBe(1);
  });

  test("returns a snippet centred on the body match", async () => {
    const results = await searchWikiPages({ query: "smoke tests" }, wikiFixtureClient());
    expect(results[0]!.snippet).toContain("smoke tests");
  });

  test("exact mode finds nothing for a typo", async () => {
    const results = await searchWikiPages(
      { query: "onboardng", matchMode: "exact" },
      wikiFixtureClient()
    );
    expect(results).toHaveLength(0);
  });
});
```

Ensure `tests/wikis.test.ts` imports `getWikiPage`, `searchWikiPages`, and `OpenProjectError`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/wikis.test.ts`
Expected: FAIL — `page.text` is undefined and `matchMode` is not accepted.

- [ ] **Step 3: Retain the page body**

In `src/services/wikis.ts`, add `text` to the interface:

```ts
export interface WikiPageDetail {
  id: number;
  title: string;
  /** Raw markdown body from the formattable `text` field. */
  text?: string;
  project: { id: number; identifier?: string; name?: string };
  attachments: WikiPageAttachment[];
}
```

Then in `normalizeWikiPageDetail`, after the `title` assignment, add:

```ts
  const text = extractRawText(resource.text);
```

and include it in the returned object:

```ts
  return {
    id,
    title,
    ...(text ? { text } : {}),
    project,
    attachments,
  };
```

Add `extractRawText` to the existing `hal-parser.ts` import:

```ts
import { extractIdFromHref, extractRawText } from "../client/hal-parser.ts";
```

- [ ] **Step 4: Rank the search results**

In `src/services/wikis.ts`, extend the params and add the result type:

```ts
export interface SearchWikiPagesParams {
  query?: string;
  projectId?: string | number;
  limit?: number;
  refreshCache?: boolean;
  matchMode?: MatchMode;
}

export type WikiPageSearchResult = WikiPageSummary & {
  /** Relevance score in the range 0..1. */
  score: number;
  snippet?: string;
  matchedFields: string[];
};
```

Change the signature to `Promise<WikiPageSearchResult[]>` and replace step 4 ("Filter cached pages") and step 5 ("Apply limit") at the end of `searchWikiPages` with:

```ts
  // 4. Scope cached pages to the target project
  const allPages = Array.from(cacheMap.values()).filter(
    (page) => targetProjectId === undefined || page.project.id === targetProjectId
  );

  // 5. Rank by relevance
  const query = params?.query?.trim() ?? "";
  if (query.length === 0) {
    const limited =
      params?.limit !== undefined && params.limit > 0
        ? allPages.slice(0, params.limit)
        : allPages;
    return limited.map((page) => ({
      ...toWikiPageSummary(page),
      score: 0,
      matchedFields: [],
    }));
  }

  const fields: FieldSpec<WikiPageDetail>[] = [
    { name: "title", weight: 3, extract: (page) => page.title },
    { name: "text", weight: 1, extract: (page) => page.text },
  ];

  const ranked = rankRecords(allPages, query, fields, {
    matchMode: params?.matchMode ?? "fuzzy",
    limit: params?.limit,
  });

  return ranked.map((entry) => ({
    ...toWikiPageSummary(entry.record),
    score: entry.score,
    snippet: entry.matches[0]?.snippet,
    matchedFields: entry.matches.map((match) => match.field),
  }));
```

Add to the imports:

```ts
import { rankRecords, type FieldSpec, type MatchMode } from "../search/rank.ts";
```

- [ ] **Step 5: Update the tool schema**

In `src/tools/wikis.ts`, change the `query` description and add `matchMode` to `searchWikiPagesShape`:

```ts
  query: z
    .string()
    .optional()
    .describe(
      "Search keywords matched against wiki page titles and page body text. " +
        "Natural-language phrasing works."
    ),
  matchMode: z
    .enum(["fuzzy", "exact"])
    .optional()
    .default("fuzzy")
    .describe(
      "Matching strategy. 'fuzzy' (default) tolerates typos, word reordering, and " +
        "partial words. Use 'exact' only for literal strings you know verbatim."
    ),
```

and update the `searchWikiPagesTool` description to:

```ts
  description:
    "Search wiki pages by title and page content. Accepts natural-language " +
    "phrasing and tolerates typos. Returns results ranked by relevance.",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/wikis.test.ts`
Expected: PASS, including the pre-existing wiki tests.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/services/wikis.ts src/tools/wikis.ts tests/wikis.test.ts
git commit -m "feat(wikis): search page body text with fuzzy relevance ranking"
```

---

### Task 8: Work Package Integration

**Files:**
- Modify: `src/services/work-packages.ts` (`SearchWorkPackagesOptions` at 28-32; `searchWorkPackages` at 77-90)
- Modify: `src/tools/work-packages.ts` (add `searchWorkPackagesShape`, handler, tool definition; extend `workPackageTools`)
- Modify: `tests/mcp-server.test.ts:24,146` and `tests/read-only.test.ts:90,121` (tool count 18 → 19)
- Modify: `tests/tools.test.ts:613` (`workPackageTools` length 3 → 4)
- Test: `tests/services.test.ts` (extend)

**A new tool is required.** `searchWorkPackages` is currently a service helper that only the test suite calls — no MCP tool invokes it, and `openproject_list_work_packages` calls `listWorkPackages` directly. Without registering `openproject_search_work_packages`, everything built in this task is unreachable by an LLM. `openproject_list_work_packages` keeps its existing server-side `subject ~` behaviour and does **not** gain `matchMode`, so that one tool's response shape never depends on which arguments were passed.

**Interfaces:**
- Consumes: `searchPipeline` from `../search/pipeline.ts`; `FieldSpec`, `MatchMode` from `../search/rank.ts`; existing `listWorkPackages`, `getWorkPackage`, `listWorkPackageActivities`.
- Produces: `searchWorkPackages(query: string, options?: SearchWorkPackagesOptions, client?: OpenProjectClient): Promise<WorkPackageSearchPage>` where `WorkPackageSearchPage = PaginatedResult<WorkPackageSearchResult> & { degraded: boolean; enrichmentFailures: number }` and `WorkPackageSearchResult = { workPackage: WorkPackageSummary; score: number; matchedFields: string[]; snippet?: string }`.

**Union strategy:** a naive change here would trade a cheap server-side filter for an expensive client-side scan. Instead, two requests run in parallel — the existing precise `subject ~ query` filter, and a broad candidate window with the caller's other filters but no subject filter, sorted `updatedAt` descending. Results are unioned and deduplicated, so exact hits are guaranteed to survive and fuzzy matching only ever adds.

- [ ] **Step 1: Write the failing tests**

Append to `tests/services.test.ts`:

```ts
describe("Work Package Fuzzy Search", () => {
  function workPackageFixtureClient(calls: string[] = []) {
    const elements = [
      {
        _type: "WorkPackage",
        id: 1,
        subject: "Fix login redirect",
        _links: {
          type: { title: "Bug" },
          status: { title: "New" },
          project: { href: "/api/v3/projects/1", title: "Demo project" },
        },
        updatedAt: "2026-09-10T00:00:00Z",
      },
      {
        _type: "WorkPackage",
        id: 2,
        subject: "Update dependencies",
        _links: {
          type: { title: "Task" },
          status: { title: "New" },
          project: { href: "/api/v3/projects/1", title: "Demo project" },
        },
        updatedAt: "2026-09-11T00:00:00Z",
      },
    ];

    return {
      get: async (path: string) => {
        calls.push(path);
        if (path.startsWith("work_packages/") || path.startsWith("/api/v3/work_packages/")) {
          const id = Number(path.replace(/\D+/g, ""));
          if (path.includes("activities")) {
            return {
              _type: "Collection",
              _embedded: {
                elements:
                  id === 2
                    ? [
                        {
                          id: 90,
                          version: 1,
                          createdAt: "2026-09-11T00:00:00Z",
                          comment: { raw: "Blocked by the expired TLS certificate" },
                          _links: { user: { href: "/api/v3/users/4", title: "Admin" } },
                        },
                      ]
                    : [],
              },
            };
          }
          const match = elements.find((e) => e.id === id);
          return { ...match, description: { raw: id === 1 ? "Session cookie is dropped" : "" } };
        }
        return {
          _type: "Collection",
          total: elements.length,
          count: elements.length,
          pageSize: 100,
          offset: 1,
          _embedded: { elements },
        };
      },
    } as unknown as OpenProjectClient;
  }

  test("finds a work package despite a typo in the subject query", async () => {
    const result = await searchWorkPackages("login redirct", {}, workPackageFixtureClient());
    expect(result.elements[0]!.workPackage.id).toBe(1);
  });

  test("finds a work package by a comment only", async () => {
    const result = await searchWorkPackages("TLS certificate", {}, workPackageFixtureClient());
    expect(result.elements[0]!.workPackage.id).toBe(2);
    expect(result.elements[0]!.matchedFields).toContain("comments");
  });

  test("finds a work package by description only", async () => {
    const result = await searchWorkPackages("session cookie", {}, workPackageFixtureClient());
    expect(result.elements[0]!.workPackage.id).toBe(1);
    expect(result.elements[0]!.matchedFields).toContain("description");
  });

  test("still issues the precise server-side subject filter", async () => {
    const calls: string[] = [];
    await searchWorkPackages("login", {}, workPackageFixtureClient(calls));
    expect(calls.some((path) => path.includes("subject"))).toBe(true);
  });

  test("exact mode finds nothing for a typo", async () => {
    const result = await searchWorkPackages(
      "login redirct",
      { matchMode: "exact" },
      workPackageFixtureClient()
    );
    expect(result.elements).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services.test.ts`
Expected: FAIL — `result.elements[0].workPackage` is undefined (the current function returns bare summaries).

- [ ] **Step 3: Implement the union search**

In `src/services/work-packages.ts`, replace `SearchWorkPackagesOptions` and `searchWorkPackages` with:

```ts
export interface SearchWorkPackagesOptions {
  projectId?: number | string;
  pageSize?: number;
  offset?: number;
  status?: "open" | "closed" | string | number;
  typeId?: number | string;
  assigneeId?: number | string;
  matchMode?: MatchMode;
}

export interface WorkPackageSearchResult {
  workPackage: WorkPackageSummary;
  /** Relevance score in the range 0..1. */
  score: number;
  matchedFields: string[];
  snippet?: string;
}

export interface WorkPackageSearchPage extends PaginatedResult<WorkPackageSearchResult> {
  degraded: boolean;
  enrichmentFailures: number;
}

interface WorkPackageDeepContent {
  id: number;
  description: string;
  comments: string[];
}

const MAX_WORK_PACKAGE_CANDIDATES = 250;

/**
 * Fetches the description and comment text for one work package.
 */
async function fetchWorkPackageDeepContent(
  workPackageId: number,
  client: OpenProjectClient
): Promise<WorkPackageDeepContent> {
  const [detail, activities] = await Promise.all([
    getWorkPackage(workPackageId, client),
    listWorkPackageActivities({ workPackageId, onlyComments: true }, client),
  ]);

  return {
    id: workPackageId,
    description: detail.description ?? "",
    comments: activities
      .map((activity) => activity.comment ?? "")
      .filter((comment) => comment.length > 0),
  };
}

/**
 * Searches work packages by subject, description, and comments using fuzzy
 * matching.
 *
 * Candidates come from the union of two parallel requests: the precise
 * server-side `subject ~ query` filter (so every result the old
 * implementation returned is still returned) and a broad recency-ordered
 * window (so fuzzy matching has something to rank). Fuzzy matching therefore
 * only ever adds results, never removes them.
 */
export async function searchWorkPackages(
  query: string,
  options?: SearchWorkPackagesOptions,
  client?: OpenProjectClient
): Promise<WorkPackageSearchPage> {
  const opClient = resolveClient(client);
  const matchMode = options?.matchMode ?? "fuzzy";

  const sharedFilters = {
    projectId: options?.projectId,
    status: options?.status,
    typeId: options?.typeId,
    assigneeId: options?.assigneeId,
  };

  const fetchCandidates = async (): Promise<WorkPackageSummary[]> => {
    const [precise, broad] = await Promise.all([
      listWorkPackages(
        { ...sharedFilters, subject: query, pageSize: MAX_WORK_PACKAGE_CANDIDATES },
        opClient
      ).catch(() => ({ elements: [] as WorkPackageSummary[] })),
      matchMode === "exact"
        ? Promise.resolve({ elements: [] as WorkPackageSummary[] })
        : listWorkPackages(
            {
              ...sharedFilters,
              pageSize: MAX_WORK_PACKAGE_CANDIDATES,
              sortBy: '[["updatedAt","desc"]]',
            },
            opClient
          ).catch(() => ({ elements: [] as WorkPackageSummary[] })),
    ]);

    const byId = new Map<number, WorkPackageSummary>();
    for (const item of [...precise.elements, ...broad.elements]) {
      byId.set(item.id, item);
    }
    return Array.from(byId.values()).slice(0, MAX_WORK_PACKAGE_CANDIDATES);
  };

  const shallowFields: FieldSpec<WorkPackageSummary>[] = [
    { name: "subject", weight: 3, extract: (wp) => wp.subject },
  ];

  const deepFields: FieldSpec<WorkPackageDeepContent>[] = [
    { name: "description", weight: 1, extract: (d) => d.description },
    { name: "comments", weight: 1, extract: (d) => d.comments },
  ];

  const result = await searchPipeline<WorkPackageSummary, WorkPackageDeepContent>(
    {
      fetchCandidates,
      shallowFields,
      enrich: (workPackage) => fetchWorkPackageDeepContent(workPackage.id, opClient),
      deepFields,
      recencyOf: (workPackage) => workPackage.updatedAt ?? "",
      idOf: (workPackage) => workPackage.id,
    },
    query,
    { matchMode }
  );

  const all: WorkPackageSearchResult[] = result.ranked.map((entry) => ({
    workPackage: entry.record,
    score: entry.score,
    matchedFields: entry.matches.map((match) => match.field),
    snippet: entry.matches[0]?.snippet,
  }));

  const offset = options?.offset ?? 1;
  const pageSize = options?.pageSize ?? 20;
  const startIndex = Math.max(0, offset - 1);
  const paged = all.slice(startIndex, startIndex + pageSize);

  return {
    total: all.length,
    count: paged.length,
    pageSize,
    offset,
    elements: paged,
    items: paged,
    degraded: result.degraded,
    enrichmentFailures: result.enrichmentFailures,
  };
}
```

Add to the imports at the top of `src/services/work-packages.ts`:

```ts
import { searchPipeline } from "../search/pipeline.ts";
import type { FieldSpec, MatchMode } from "../search/rank.ts";
```

- [ ] **Step 4: Register the new search tool**

In `src/tools/work-packages.ts`, add the shape, handler, and tool definition. Leave `listWorkPackagesShape` untouched.

```ts
export const searchWorkPackagesShape = {
  query: z
    .string()
    .min(1)
    .describe(
      "Search text matched against work package subjects, descriptions, and " +
        "comments. Natural-language phrasing works and typos are tolerated."
    ),
  projectId: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe("Scope search to a specific project by numeric ID or slug identifier"),
  status: z
    .union([z.enum(["open", "closed"]), z.number().int().positive()])
    .optional()
    .describe("Filter by status: 'open', 'closed', or numeric status ID"),
  matchMode: z
    .enum(["fuzzy", "exact"])
    .optional()
    .default("fuzzy")
    .describe(
      "Matching strategy. 'fuzzy' (default) tolerates typos, word reordering, and " +
        "partial words. Use 'exact' only for literal strings you know verbatim."
    ),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1)
    .describe("Page number to retrieve (1-based, default 1)"),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(20)
    .describe("Number of items per page (max 100, default 20)"),
};

export type SearchWorkPackagesArgs = z.input<z.ZodObject<typeof searchWorkPackagesShape>>;

/**
 * Tool execution handler for openproject_search_work_packages.
 */
export async function handleSearchWorkPackages(
  args: SearchWorkPackagesArgs
): Promise<McpToolResponse> {
  try {
    const result = await searchWorkPackages(args.query, {
      projectId: args.projectId,
      status: args.status,
      matchMode: args.matchMode,
      offset: args.offset,
      pageSize: args.pageSize,
    });
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const searchWorkPackagesTool: ToolDefinition<
  typeof searchWorkPackagesShape,
  SearchWorkPackagesArgs
> = {
  name: "openproject_search_work_packages",
  description:
    "Search work packages by subject, description, and comments. Accepts " +
    "natural-language phrasing and tolerates typos. Returns results ranked by " +
    "relevance with matching excerpts.",
  parameters: searchWorkPackagesShape,
  readOnly: true,
  execute: handleSearchWorkPackages,
};
```

Add `searchWorkPackages` to the existing service import at the top of the file, and add the tool to the exported array:

```ts
export const workPackageTools = [
  listWorkPackagesTool,
  getWorkPackageTool,
  listWorkPackageActivitiesTool,
  searchWorkPackagesTool,
];
```

- [ ] **Step 5: Update the tool count assertions**

Adding a tool takes the registry from 18 to 19. Update these four assertions and their surrounding test names:

- `tests/mcp-server.test.ts:24` — `expect(toolsResult.tools).toHaveLength(18)` → `19`
- `tests/mcp-server.test.ts:146` — same change
- `tests/read-only.test.ts:90` — `expect(toolsResult.tools).toHaveLength(18)` → `19`
- `tests/read-only.test.ts:121` — `expect(standaloneTools.tools).toHaveLength(18)` → `19`
- `tests/tools.test.ts:613` — `expect(workPackageTools).toHaveLength(3)` → `4`

Also update the test titles that read "lists all 18 tools" to say 19. The new tool is `readOnly: true`, so it must still appear in the read-only listing — that is what the `read-only.test.ts` assertions verify.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/services.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all green, including the updated tool-count assertions.

- [ ] **Step 8: Commit**

```bash
git add src/services/work-packages.ts src/tools/work-packages.ts tests/services.test.ts tests/mcp-server.test.ts tests/read-only.test.ts tests/tools.test.ts
git commit -m "feat(work-packages): add ranked search tool over subject, description, and comments"
```

---

### Task 9: Activity Ranking

**Files:**
- Modify: `src/services/work-packages.ts` (`ListWorkPackageActivitiesOptions` at 111-114; `listWorkPackageActivities` at 119-173)
- Modify: `src/tools/work-packages.ts` (`listWorkPackageActivitiesShape` at 170-183)
- Test: `tests/work-package-activities.test.ts` (extend)

**Interfaces:**
- Consumes: `rankRecords`, `FieldSpec`, `MatchMode` from `../search/rank.ts`.
- Produces: `listWorkPackageActivities(options: ListWorkPackageActivitiesOptions, client?: OpenProjectClient): Promise<WorkPackageActivity[]>` with `options` extended by `query?: string` and `matchMode?: MatchMode`.

**Why no standalone search tool:** OpenProject v3 exposes activities only per work package, so an `openproject_search_activities` tool would still demand the `workPackageId` a model is searching in order to find. Activity comment text instead enters the work package deep phase (Task 8), and this task adds client-side ranking to the list the tool already fetches — no extra API calls.

- [ ] **Step 1: Write the failing tests**

Append to `tests/work-package-activities.test.ts`:

```ts
describe("Activity Ranking", () => {
  function activitiesClient() {
    return {
      get: async () => ({
        _type: "Collection",
        _embedded: {
          elements: [
            {
              id: 1,
              version: 1,
              createdAt: "2026-09-01T00:00:00Z",
              comment: { raw: "Deployment blocked by the expired TLS certificate" },
              _links: { user: { href: "/api/v3/users/4", title: "Admin" } },
            },
            {
              id: 2,
              version: 2,
              createdAt: "2026-09-02T00:00:00Z",
              comment: { raw: "Merged the dependency bump" },
              _links: { user: { href: "/api/v3/users/5", title: "Dev" } },
            },
          ],
        },
      }),
    } as unknown as OpenProjectClient;
  }

  test("ranks activities by relevance when a query is supplied", async () => {
    const result = await listWorkPackageActivities(
      { workPackageId: 1, query: "TLS certificate" },
      activitiesClient()
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(1);
  });

  test("tolerates a typo in the query", async () => {
    const result = await listWorkPackageActivities(
      { workPackageId: 1, query: "certificat" },
      activitiesClient()
    );
    expect(result[0]!.id).toBe(1);
  });

  test("returns every activity when no query is supplied", async () => {
    const result = await listWorkPackageActivities({ workPackageId: 1 }, activitiesClient());
    expect(result).toHaveLength(2);
  });

  test("exact mode finds nothing for a typo", async () => {
    const result = await listWorkPackageActivities(
      { workPackageId: 1, query: "certificat", matchMode: "exact" },
      activitiesClient()
    );
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/work-package-activities.test.ts`
Expected: FAIL — `query` is not accepted, all activities returned.

- [ ] **Step 3: Implement ranking**

In `src/services/work-packages.ts`, extend the options interface:

```ts
export interface ListWorkPackageActivitiesOptions {
  workPackageId: number;
  onlyComments?: boolean;
  /** Ranks the fetched activities client-side. No extra API calls. */
  query?: string;
  matchMode?: MatchMode;
}
```

Then, immediately before the closing `return activities;` of `listWorkPackageActivities`, insert:

```ts
  const query = options.query?.trim() ?? "";
  if (query.length === 0) {
    return activities;
  }

  const fields: FieldSpec<WorkPackageActivity>[] = [
    { name: "comment", weight: 3, extract: (activity) => activity.comment },
    {
      name: "details",
      weight: 1,
      extract: (activity) => activity.details.map((detail) => detail.raw),
    },
  ];

  return rankRecords(activities, query, fields, {
    matchMode: options.matchMode ?? "fuzzy",
  }).map((entry) => entry.record);
```

Add `rankRecords` to the existing search import:

```ts
import { rankRecords } from "../search/rank.ts";
```

- [ ] **Step 4: Update the tool schema**

In `src/tools/work-packages.ts`, add to `listWorkPackageActivitiesShape`:

```ts
  query: z
    .string()
    .optional()
    .describe(
      "Optional search text to rank activities by relevance. Matched against " +
        "comment text and change details; tolerates typos."
    ),
  matchMode: z
    .enum(["fuzzy", "exact"])
    .optional()
    .default("fuzzy")
    .describe(
      "Matching strategy. 'fuzzy' (default) tolerates typos, word reordering, and " +
        "partial words. Use 'exact' only for literal strings you know verbatim."
    ),
```

and pass them through in `handleListWorkPackageActivities`:

```ts
    const result = await listWorkPackageActivities({
      workPackageId: args.workPackageId,
      onlyComments: args.onlyComments,
      query: args.query,
      matchMode: args.matchMode,
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/work-package-activities.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/work-packages.ts src/tools/work-packages.ts tests/work-package-activities.test.ts
git commit -m "feat(activities): rank work package activities by relevance"
```

---

### Task 10: Recall Suite

**Files:**
- Create: `tests/search/recall.test.ts`

**Interfaces:**
- Consumes: `rankRecords`, `FieldSpec` from `../../src/search/rank.ts`.
- Produces: nothing — this is the acceptance test.

**Purpose:** every other suite verifies that nothing broke. This one measures whether the feature actually does what was asked: that realistic LLM phrasings find the right record. If a scoring constant is later tuned, this suite is what says whether the tuning helped.

- [ ] **Step 1: Write the recall suite**

Create `tests/search/recall.test.ts`:

```ts
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
  { query: "muller", expectedId: 1, why: "diacritic-insensitive person match, best title weight" },
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
```

- [ ] **Step 2: Run the recall suite**

Run: `bun test tests/search/recall.test.ts`
Expected: PASS, 16 tests.

If a case fails, **do not weaken the assertion.** Tune the scoring constants in `src/search/score.ts` (`EDIT_PENALTY`, `PHRASE_BONUS`) or the field weights, then re-run every suite in `tests/search/` to confirm nothing regressed. The recall table is the specification of correct behaviour here; the constants serve it.

- [ ] **Step 3: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/search/recall.test.ts
git commit -m "test(search): add recall suite for realistic natural-language queries"
```

---

### Task 11: Documentation

**Files:**
- Modify: `docs/DECISIONS.md` (append ADR-019)
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: everything built in Tasks 1-10.
- Produces: nothing executable.

AGENTS.md §2.2 requires an ADR for any change that alters design, dependencies, or interfaces. This change does all three.

- [ ] **Step 1: Append ADR-019 to `docs/DECISIONS.md`**

```markdown
## ADR-019: Fuzzy Search by Default with a Hand-Rolled Zero-Dependency Scorer

### Status

Accepted

### Context

Every search surface matched with case-insensitive exact substring containment.
An LLM asking for "budget aproval", "approval of the budget", or "what did we
decide about hiring" received zero results even when the information was
present, and then reported to the user that it did not exist. Search also
covered far less content than callers assumed: wiki search matched page titles
only, and work package search matched subjects only.

### Decision

1. **Fuzzy matching is the default** across all search tools, with an
   optional `matchMode: "fuzzy" | "exact"` parameter. Exact mode reproduces
   the previous behaviour byte for byte, which lets the pre-existing test
   suites serve as a regression harness.
2. **A hand-rolled scorer in `src/search/`**, adding no runtime dependencies.
   `fuse.js` was rejected because its Bitap implementation caps patterns at 32
   characters and targets short fields in modest lists — the opposite of the
   wiki-body and comment matching this change requires. Running two scoring
   systems to cover both cases was worse than owning ~200 lines of pure,
   synchronous, trivially testable code. `fastest-levenshtein` was rejected
   because the distance function is roughly 30 lines with the early-exit band
   we need, and fetching, not distance computation, dominates the time.
3. **A bounded two-phase pipeline.** Phase 1 ranks on data already returned by
   list endpoints; phase 2 enriches only the top 25 candidates at a
   concurrency of 8. This replaces an unbounded `Promise.all` over up to 250
   candidates in the previous meeting search.
4. **Content coverage widened** to wiki page bodies, work package descriptions
   and comments, and meeting participants and project names.
5. **A new `openproject_search_work_packages` tool**, taking the registry from
   18 to 19 tools. `searchWorkPackages` previously existed as a service helper
   that no tool invoked, so ranked work package search would otherwise have been
   unreachable. `openproject_list_work_packages` keeps its server-side
   `subject ~` filter unchanged, keeping "filter" and "rank" as separate tools
   rather than making one tool's response shape depend on its arguments.
6. **No standalone activities search tool**, because OpenProject exposes
   activities only per work package. Comment text enters the work package deep
   phase instead.

### Consequences

- LLM search hit rates improve substantially for paraphrased and misspelled
  queries; results are ranked and carry `score` and `matchedFields`.
- Enrichment failures now surface as `degraded` / `enrichmentFailures` rather
  than being silently swallowed. Previously an expired token during a meeting
  search produced "no results" instead of an auth error.
- `src/search/` is pure and holds no module-level state, so it does not
  reintroduce the cross-tenant cache exposure fixed in commit `7097d1c`.
- Two accepted limitations: a record whose only match is deep content is
  findable only within the 25-item enrichment window (see spec section 6.1),
  and wiki search remains bounded by the ID 1..50 discovery probe (spec
  section 6.2).
- Scoring constants are tuning parameters. `tests/search/recall.test.ts` is
  the acceptance test that governs them.
```

- [ ] **Step 2: Document the unit in `docs/ARCHITECTURE.md`**

Add a section describing `src/search/` as a pure computation unit between the tools and services layers: `tokenize.ts` (normalization and offsets), `score.ts` (edit distance and field scoring), `rank.ts` (generic `FieldSpec<T>` ranking), `snippet.ts` (excerpts), `pipeline.ts` (two-phase orchestration and bounded concurrency). State that it performs no I/O, holds no module-level state, and that services declare *what* to search while the unit decides *how well* it matches.

- [ ] **Step 3: Update `README.md`**

Add the new `openproject_search_work_packages` row to the tool table and update the stated tool count from 18 to 19. Note for each search tool that it accepts `matchMode` (default `"fuzzy"`) and returns `score` and `matchedFields`. Add a short "Search behaviour" subsection stating that fuzzy is the default, that typos and reordered words are tolerated, and that `matchMode: "exact"` restores literal substring matching.

- [ ] **Step 4: Update `docs/TODO.md`**

Mark the fuzzy search milestone complete. Add two tracked follow-ups: the two-phase recall ceiling (spec §6.1) and the wiki discovery probe window (spec §6.2).

- [ ] **Step 5: Verify the whole suite one final time**

Run: `bun test && bun run typecheck`
Expected: all tests pass, typecheck silent. Record the actual test count in the commit message.

- [ ] **Step 6: Commit**

```bash
git add docs/DECISIONS.md docs/ARCHITECTURE.md README.md docs/TODO.md
git commit -m "docs: record ADR-019 and document fuzzy search behaviour"
```

---

## Verification Checklist

Before considering this plan complete, confirm each of the following by running the command and reading the output — not by assuming:

- [ ] `bun test` passes with no failures.
- [ ] `bun run typecheck` exits 0 with no output.
- [ ] `git log --oneline` shows one commit per task, all conventional.
- [ ] `grep -r "fuse\|levenshtein" package.json` returns nothing — no dependency was added.
- [ ] `tests/search/recall.test.ts` passes every case without any assertion having been weakened.
- [ ] The pre-existing meeting and wiki tests still pass, proving exact mode is compatible.
- [ ] `openproject_search_work_packages` appears in the tool listing and in the read-only listing.
