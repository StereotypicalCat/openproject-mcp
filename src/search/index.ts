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
