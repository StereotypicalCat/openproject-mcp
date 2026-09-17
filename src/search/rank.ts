/**
 * Generic relevance ranking over record collections.
 *
 * Services declare WHAT to search via FieldSpec declarations; this module
 * decides HOW WELL each record matches.
 */

import { normalizeText, tokenizeQuery } from "./tokenize.ts";
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
 *
 * The minScore gate is applied to the RAW field score, never to this
 * weighted value.
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

  const queryTokens = tokenizeQuery(trimmedQuery);
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
    let bestRaw = 0;

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

        if (bestScore.score > bestRaw) {
          bestRaw = bestScore.score;
        }

        const weighted = (bestScore.score * spec.weight) / maxWeight;
        if (weighted > bestWeighted) {
          bestWeighted = weighted;
        }
      }
    }

    // Gate on the RAW score (is this a real match?), order by the weighted
    // score (how important is where it matched?). Gating on the weighted
    // score would make every low-weight field unreachable — see the note in
    // the plan for this task.
    if (bestRaw >= threshold) {
      matches.sort((a, b) => b.score - a.score);
      ranked.push({ record, score: Number(bestWeighted.toFixed(2)), matches });
    }
  }

  ranked.sort((a, b) => b.score - a.score || idOf(a.record) - idOf(b.record));

  return opts?.limit !== undefined && opts.limit > 0 ? ranked.slice(0, opts.limit) : ranked;
}
