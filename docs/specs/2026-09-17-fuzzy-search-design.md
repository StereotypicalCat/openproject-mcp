# Specification: Fuzzy Search by Default Across MCP Search Tools

## 1. Overview & Objectives

Every search surface in `openproject-mcp` currently matches with case-insensitive
exact substring containment. An LLM that asks for `"budget aproval"`, `"approval of
the budget"`, or `"what did we decide about hiring"` gets zero results even when the
information is present, because none of those strings appear verbatim. The model then
reports that nothing exists.

This specification replaces exact substring matching with token-aware fuzzy matching
as the **default** behaviour across all search tools, adds relevance ranking, and
widens the set of content that is actually searched.

### Objectives

1. Tolerate typos, word reordering, partial words, and diacritic differences.
2. Rank results by relevance rather than returning them in arbitrary API order.
3. Search content that is currently ignored: wiki page body text, work package
   descriptions and comments, meeting participants and project names.
4. Keep the cost of a single search call bounded and predictable.
5. Preserve an escape hatch (`matchMode: "exact"`) with byte-for-byte legacy behaviour.
6. Add zero runtime dependencies.

### Current Behaviour Being Replaced

| Tool | Matching today | Location |
| --- | --- | --- |
| `openproject_search_meetings` | Exact substring over title, location, agenda item title/notes, outcome notes | `src/services/meetings.ts:369` |
| `openproject_search_wiki_pages` | Exact substring over **title only** | `src/services/wikis.ts:257` |
| `openproject_list_work_packages` (`subject` arg) | Server-side OpenProject `~` filter on **subject only** | `src/client/filter-builder.ts:86` |
| `searchWorkPackages` service helper | Same; **not reachable from any MCP tool** — called only by tests | `src/services/work-packages.ts:79` |
| `openproject_list_work_package_activities` | No search capability | `src/services/work-packages.ts:119` |

---

## 2. Architectural Design

A new pure-computation unit `src/search/` sits beside the client layer. It has no
I/O, no dependency on `OpenProjectClient`, and no module-level state. Domain services
declare *what* to search; the search unit decides *how well* it matches.

```
   MCP Client (Claude / Antigravity / Cursor)
                     │
                     ▼
          McpServer (src/server.ts)
                     │
                     ▼ wrapExecute (RequestContext)
  ┌──────────────────┼──────────────────┬─────────────────────┐
  ▼                  ▼                  ▼                     ▼
Meetings Tools   Wikis Tools    Work Package Tools    (matchMode param
  │                  │                  │              on every shape)
  ▼                  ▼                  ▼
Meetings Svc      Wikis Svc      Work Packages Svc
  │                  │                  │
  └──────────────────┴────────┬─────────┘
                              │ FieldSpec<T> declarations
                              ▼
                     src/search/  (pure, no I/O)
                     ├── tokenize.ts   normalize + split
                     ├── score.ts      token & field scoring
                     ├── rank.ts       generic record ranking
                     ├── snippet.ts    match-centred excerpts
                     └── pipeline.ts   two-phase orchestration
                              │
                              ▼ (pipeline calls back into services)
                        OpenProjectClient
                              ▼
                      OpenProject 17 API v3
```

### 2.1 Tokenization (`src/search/tokenize.ts`)

```typescript
export function normalizeText(text: string): string;
export function tokenize(text: string): string[];
```

- `normalizeText` lowercases, applies Unicode NFKD normalization, and strips combining
  marks, so `Müller` matches `muller` and `café` matches `cafe`.
- `tokenize` splits normalized text on non-alphanumeric boundaries and discards empty
  segments.
- Both query text and field text pass through the identical path. Any divergence
  between the two sides silently breaks matching, so there is exactly one
  implementation.

### 2.2 Scoring Primitives (`src/search/score.ts`)

```typescript
export function boundedLevenshtein(a: string, b: string, max: number): number;
export function scoreToken(queryToken: string, fieldToken: string): number;
export function scoreField(queryTokens: string[], fieldText: string): FieldScore;

export interface FieldScore {
  score: number;              // 0..1
  matchedOffsets: number[];   // character offsets in fieldText, for snippets
}
```

**Token scoring rules**, applied in order, first match wins:

| Rule | Score | Guard |
| --- | --- | --- |
| Exact token equality | `1.0` | — |
| Field token starts with query token | `0.9` | query token length >= 3 |
| Field token contains query token | `0.75` | query token length >= 4 |
| Edit distance `d` within budget | `1 - (d / queryToken.length) * 0.6` | `d <= 1` for length < 6; `d <= 2` for length >= 6 |
| Otherwise | `0` | — |

The length guards are load-bearing. Without them `cat` -> `dog` is distance 3 and
every short token fuzzily matches every other short token, which produces noise the
LLM cannot distinguish from signal.

`boundedLevenshtein` is a two-row dynamic programming implementation with a diagonal
band and early exit: it abandons a pair as soon as the minimum of the current row
exceeds `max`. The overwhelmingly common case is a non-match, and this makes the
non-match case cheap.

**Field scoring** takes, for each query token, its best score against any field
token, then aggregates:

```
fieldScore = mean(bestScorePerQueryToken) * coverage
coverage   = (count of query tokens with bestScore > 0) / (total query tokens)
```

Coverage is what prevents a two-word query from ranking a document that matched only
the common word. A phrase bonus of `+0.15` (result clamped to `1.0`) applies when the
full normalized query appears verbatim in the field, keeping literal matches on top of
merely fuzzy ones.

### 2.3 Record Ranking (`src/search/rank.ts`)

```typescript
export interface FieldSpec<T> {
  name: string;
  weight: number;
  extract: (record: T) => string | string[] | undefined;
}

export interface FieldMatch {
  field: string;
  score: number;
  snippet?: string;
}

export interface Ranked<T> {
  record: T;
  score: number;             // 0..1, weighted across fields
  matches: FieldMatch[];     // only fields that scored > 0, descending
}

export interface RankOptions {
  minScore?: number;         // default 0.35
  limit?: number;
  matchMode?: "fuzzy" | "exact";   // default "fuzzy"
}

export function rankRecords<T>(
  records: T[],
  query: string,
  fields: FieldSpec<T>[],
  opts?: RankOptions
): Ranked<T>[];
```

Record score is the best weighted field score, normalized so the result stays in
`0..1`:

```
recordScore = max over declared fields f of ( fieldScore(f) * weight(f) ) / maxWeight
maxWeight   = max weight across all declared fields (not only matching ones)
```

Normalizing by the maximum *declared* weight rather than the best *matching* weight is
deliberate: it means a hit on a low-weight field (say `author.name` at 0.5) yields a
proportionally lower record score instead of being rescaled up to 1.0. Otherwise a
weak incidental match would tie with a perfect title match.

Results sort by score descending; **ties break by ascending
record ID** so that repeated identical searches return identically ordered results. A
model that re-runs a search and sees a reshuffled list will draw conclusions from the
difference.

When `matchMode` is `"exact"`, `rankRecords` bypasses all fuzzy scoring and applies
plain case-insensitive substring containment, scoring `1` or `0`. This reproduces
today's behaviour exactly and lets the existing test suites serve as a regression
harness.

### 2.4 Snippets (`src/search/snippet.ts`)

```typescript
export function extractSnippet(
  text: string,
  matchedOffsets: number[],
  maxLength?: number   // default 160
): string;
```

The existing helper (`src/services/meetings.ts:250`) locates the excerpt with
`text.indexOf(query)` and, when that fails, truncates from character 0. Under fuzzy
matching `indexOf` fails on essentially every hit, so snippets would silently degrade
to "first 160 characters" — actively worse than today. The replacement centres the
window on the match offsets that `scoreField` already computed. The old helper is
removed and meetings uses this one.

### 2.5 Two-Phase Pipeline (`src/search/pipeline.ts`)

```typescript
export interface PipelineSpec<TShallow, TDeep> {
  fetchCandidates: () => Promise<TShallow[]>;
  shallowFields: FieldSpec<TShallow>[];
  enrich: (candidate: TShallow) => Promise<TDeep>;
  deepFields: FieldSpec<TDeep>[];
  enrichLimit?: number;      // default 25
  concurrency?: number;      // default 8
  recencyOf?: (candidate: TShallow) => string | number;
}

export interface PipelineResult<TShallow, TDeep> {
  ranked: Array<Ranked<TShallow> & { deep?: TDeep; deepMatches?: FieldMatch[] }>;
  degraded: boolean;
  enrichmentFailures: number;
}

export function searchPipeline<TShallow, TDeep>(
  spec: PipelineSpec<TShallow, TDeep>,
  query: string,
  opts?: RankOptions
): Promise<PipelineResult<TShallow, TDeep>>;
```

**Phase 1** ranks candidates using only data the list endpoint already returned. This
costs no additional API calls.

**Phase 2** enriches a bounded subset and re-ranks. Final record score is
`max(shallowScore, deepScore)` — deliberately not a sum. A dead-on title match must
not be diluted by an unrelated body paragraph.

**Enrichment set selection.** The set is the top `enrichLimit` candidates by shallow
score, **backfilled to `enrichLimit` with the most recently updated candidates** when
fewer than that pass the shallow gate.

`recencyOf` supplies the backfill ordering. When it is omitted, backfill falls back to
the candidate order the API returned, which is stable but arbitrary. Each service
supplies it explicitly: meetings use `startTime` (there is no `updatedAt` on
`MeetingSummary`), work packages use `updatedAt`, and wikis do not use the pipeline at
all.

This backfill exists because of a genuine structural weakness: a record whose only
match lives in deep content scores `0` shallow, so it is never enriched and therefore
cannot be found. Queries like "what did we decide about hiring" are exactly that
shape. The backfill narrows the gap without closing it — see Section 6.1.

**Concurrency.** Enrichment runs through `mapWithConcurrency(items, concurrency, fn)`.
The current meeting search issues `Promise.all` over up to 250 candidates
(`src/services/meetings.ts:480`), firing up to 250 simultaneous agenda-item requests
at the OpenProject instance. Capping the enrichment set at 25 and the in-flight count
at 8 fixes that fan-out as a side effect of the redesign.

---

## 3. Per-Service Integration

### 3.1 Meetings (`src/services/meetings.ts`)

Candidates come from the existing `listMeetings` paging loop (250 cap, unchanged).

| Phase | Field | Weight | Extra API cost |
| --- | --- | --- | --- |
| Shallow | `title` | 3.0 | none |
| Shallow | `location` | 1.0 | none |
| Shallow | `project.name` | 0.5 | none |
| Shallow | `author.name` | 0.5 | none |
| Deep | agenda item `title` | 2.0 | existing agenda fetch |
| Deep | agenda item `notes` | 1.5 | existing agenda fetch |
| Deep | outcome `notes` | 1.5 | existing agenda fetch |
| Deep | `participants[].name` | 1.0 | meeting detail fetch |

`MeetingSummary` already carries `project.name` and `author.name`, so those four
shallow fields are free. Participants exist only on `MeetingDetail` and require the
deep fetch.

`MeetingSearchResult` is extended, not replaced:

```typescript
export interface MeetingSearchResult {
  meeting: MeetingSummary;
  matchType: "title" | "location" | "agenda_item" | "participant" | "project";
  matchedAgendaItems?: Array<{ id: number; title: string; snippet?: string }>;
  score: number;             // NEW
  matchedFields: string[];   // NEW
}
```

### 3.2 Wiki Pages (`src/services/wikis.ts`)

No pipeline is required: the discovery cache already holds page details locally, so
both phases collapse into one in-memory ranking pass.

`normalizeWikiPage` currently discards the page body. The `text` field is present in
the `GET /api/v3/wiki_pages/{id}` response that the service already issues, so
retaining it costs no additional API calls:

```typescript
export interface WikiPageDetail {
  id: number;
  title: string;
  text?: string;             // NEW - raw markdown from the formattable `text` field
  project: { id: number; identifier?: string; name?: string };
  attachments: WikiPageAttachment[];
}
```

Ranking: `title` weight 3.0, `text` weight 1.0. Return type becomes:

```typescript
export type WikiPageSearchResult = WikiPageSummary & {
  score: number;
  snippet?: string;
  matchedFields: string[];
};
```

### 3.3 Work Packages (`src/services/work-packages.ts`)

**A new tool is required.** There is no `openproject_search_work_packages` tool
today: `searchWorkPackages` is a service helper that only the test suite calls,
and `openproject_list_work_packages` invokes `listWorkPackages` directly. Fuzzy
work package search would therefore be unreachable by any LLM. This change
registers `openproject_search_work_packages` as a new read-only tool, taking the
MCP tool count from 18 to 19.

`openproject_list_work_packages` keeps its current server-side `subject ~`
behaviour unchanged. Splitting list (filter, flat results) from search (rank,
scored results) avoids making one tool's response shape depend on which
arguments were supplied.

A naive change to the search path would trade a cheap server-side filter for an
expensive client-side scan. Instead, **union strategy** — two requests issued in
parallel:

- **Query A**: today's server-side `subject ~ query` filter. Cheap, precise,
  guarantees that every currently-returned result is still returned.
- **Query B**: a broad candidate window using the caller's other filters (project,
  status, type, assignee) **minus** the subject filter, sorted `updatedAt` descending,
  capped at 250.

Results are unioned and deduplicated by ID, then ranked: `subject` weight 3.0 shallow;
top 25 enriched with `description` weight 1.0 and activity comments weight 1.0.

Exact matches are therefore guaranteed to survive; fuzzy matching only ever adds.

### 3.4 Work Package Activities

OpenProject v3 exposes activities only per work package
(`/api/v3/work_packages/{id}/activities`); there is no global activity collection. A
standalone `openproject_search_activities` tool would still require a
`workPackageId`, which is of little use to a model that is searching in order to
*find* the work package.

Therefore: **no new tool**. Activity comment text enters the work package deep phase
(3.3), and `openproject_list_work_package_activities` gains optional `query` and
`matchMode` parameters that rank the list it already fetches, client-side, at no extra
API cost.

---

## 4. Tool Definitions & Zod Schemas

Every search shape gains:

```typescript
matchMode: z
  .enum(["fuzzy", "exact"])
  .optional()
  .default("fuzzy")
  .describe(
    "Matching strategy. 'fuzzy' (default) tolerates typos, word reordering, and " +
    "partial words. Use 'exact' only for literal strings you know verbatim."
  ),
```

Affected shapes: `searchMeetingsShape`, `searchWikiPagesShape`,
`listWorkPackageActivitiesShape` (alongside a new optional `query`), and a new
`searchWorkPackagesShape` backing the new `openproject_search_work_packages`
tool.

`listWorkPackagesShape` is deliberately **not** changed: that tool stays a
server-side filter and does not gain `matchMode`.

Tool `description` strings are rewritten to advertise the capability, since the
description is what actually steers whether and how a model calls the tool. For
example:

> `openproject_search_meetings`: "Search meetings and agenda items. Accepts
> natural-language phrasing; tolerates typos and reordered words. Returns results
> ranked by relevance with matching excerpts."

All affected tools remain `readOnly: true`.

---

## 5. Error Handling & Edge Cases

| Case | Behaviour |
| --- | --- |
| Enrichment fails with 401 / 403 / 429 | Abort the entire search and propagate. Matches the existing wiki service precedent (`src/services/wikis.ts:300`). |
| Enrichment fails otherwise (404, 500, network) | Degrade that one record to its shallow score; set `degraded: true` and increment `enrichmentFailures`. |
| Empty or whitespace-only query, fuzzy mode | Return unranked candidates, consistent with today's optional-`query` wiki behaviour. |
| Query shorter than 3 characters | Fall back to substring containment; edit distance is meaningless at that length. |
| No results above `minScore` | Return an empty result set with `degraded` reported honestly. Never silently widen the threshold. |
| Invalid `matchMode` | Rejected by Zod before any request is issued. |

**The auth-swallowing bug.** `src/services/meetings.ts:427` currently does
`.catch(() => undefined)` on the agenda-item fetch. An expired token therefore
produces "no results" rather than an authentication error, and the model confidently
reports that no such meeting exists. The `degraded` / `enrichmentFailures` envelope
plus auth propagation is what separates "nothing matched" from "I could not read
everything".

**Tenant isolation.** `src/search/` is pure and holds no module-level state, and
`pipeline.ts` keeps all state per-call. Neither reintroduces the cross-tenant exposure
fixed for the wiki cache in commit `7097d1c`.

---

## 6. Known Limitations

These are accepted and explicitly out of scope for this change.

### 6.1 Two-Phase Recall Ceiling

A record whose only match is in deep content is findable only if it lands in the
enrichment set — that is, if it is among the 25 most recently updated candidates when
no shallow match exists. Beyond that window, deep-only matches are missed.

Eliminating this would require either full-corpus enrichment (hundreds of API calls
per search, with MCP client timeout risk) or a persistent content index (a materially
larger change, with cache invalidation and tenant isolation to get right). The
recency backfill is the bounded-cost compromise.

### 6.2 Wiki Discovery Probe Window

`searchWikiPages` builds its cache by probing wiki page IDs 1..50 with a 5-consecutive-
miss cutoff (`src/services/wikis.ts:311`). Pages beyond that window, or past a gap of
five deleted IDs, are invisible to search regardless of ranking quality. Better
ranking over an incomplete corpus is still ranking over an incomplete corpus. This is
a pre-existing defect, tracked separately.

---

## 7. Testing & Verification

Development is test-driven: scoring tests are written before the scorer.

### 7.1 Pure Unit Tests (`tests/search/`)

Table-driven, no mocks, no client. The guard cases are the point:

- `cat` vs `dog` must **not** match (distance 3, below the length gate).
- `budget` vs `budgt` must match (distance 1, length >= 6).
- `Müller` vs `muller` must match (NFKD normalization).
- Query `"budget approval"` must rank a document containing both tokens above one
  containing only `"approval"` (coverage).
- A verbatim phrase match must outrank a scattered-token match (phrase bonus).
- `boundedLevenshtein` must early-exit rather than compute full distance beyond `max`.

### 7.2 Regression via Exact Mode

The existing `tests/meetings.test.ts` and `tests/wikis.test.ts` suites re-run with
`matchMode: "exact"` and must pass **unchanged**. This is the proof that the escape
hatch is genuinely byte-for-byte compatible.

### 7.3 Pipeline Tests

Against a fake client, asserting the cost budget actually holds:

- At most 8 enrichment requests in flight at any moment.
- At most 25 enrichment calls per search.
- Recency backfill triggers when fewer than 25 candidates pass the shallow gate.
- A 401 during enrichment aborts and propagates.
- A 500 during enrichment sets `degraded: true` and leaves other results intact.

### 7.4 Recall Suite (`tests/search/recall.test.ts`)

A fixture corpus plus a table of realistic LLM phrasings mapped to expected top hits:

| Query | Expected top result |
| --- | --- |
| `"budget aproval"` | agenda item "Approval of Q3 budget" |
| `"approval of the budget"` | same |
| `"what did we decide about hiring"` | outcome note on the hiring agenda item |
| `"meeting with the design team"` | meeting whose participants include design team members |
| `"muller"` | meeting authored by Müller |

This is the only suite that measures whether the feature does what was asked. The
others measure that it breaks nothing.

### 7.5 Gate

`bun test` and `bun run typecheck` both clean before the work is considered complete.

---

## 8. Documentation Updates

Per AGENTS.md §2.2 and §2.6:

- **`docs/DECISIONS.md`**: new ADR-019 recording the zero-dependency hand-rolled
  scorer (and why `fuse.js` was rejected: its Bitap implementation caps patterns at 32
  characters and targets short fields, which is the opposite of the wiki-body and
  comment matching required here), the fuzzy-by-default contract, and the two-phase
  cost model.
- **`docs/ARCHITECTURE.md`**: the new `src/search/` unit and its position in the layering.
- **`README.md`**: tool table updated with `matchMode` and the `score` / `matchedFields`
  result fields.
- **`docs/TODO.md`**: milestone status, plus the two Section 6 limitations as tracked
  follow-ups.
