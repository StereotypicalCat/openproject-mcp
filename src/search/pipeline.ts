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
      .sort((a, b) => recencyValue(spec.recencyOf, b) - recencyValue(spec.recencyOf, a));

    for (const candidate of backfill) {
      if (selected.length >= enrichLimit) {
        break;
      }
      selected.push(candidate);
    }
  }

  // Phase 2: bounded enrichment.
  //
  // The explicit EnrichedCandidate annotation is required, not stylistic:
  // without it TypeScript infers the callback's return as a UNION of two
  // object literal types ({ deep: Awaited<TDeep> } | { deep: undefined })
  // rather than a single type with `deep: TDeep | undefined`. The narrowing
  // predicate below is then rejected, because a type predicate's type must be
  // assignable to its parameter's type and `Pair` is not assignable to the
  // `{ deep: undefined }` arm.
  interface EnrichedCandidate {
    candidate: TShallow;
    deep: TDeep | undefined;
  }

  let enrichmentFailures = 0;
  const enriched: EnrichedCandidate[] = await mapWithConcurrency<TShallow, EnrichedCandidate>(
    selected,
    concurrency,
    async (candidate) => {
      try {
        return { candidate, deep: await spec.enrich(candidate) };
      } catch (error: unknown) {
        if (isFatalSearchError(error)) {
          throw error;
        }
        enrichmentFailures++;
        return { candidate, deep: undefined };
      }
    }
  );

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
