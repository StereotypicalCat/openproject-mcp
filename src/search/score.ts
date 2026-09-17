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

/**
 * The base score is scaled by this before the phrase bonus is added.
 *
 * Load-bearing: without it a document matching every query token already
 * scores 1.0, the phrase bonus clamps to nothing, and a verbatim phrase
 * cannot outrank a scattered one — the bonus becomes dead code in exactly
 * the case it exists for. Scaling reserves the top 0.15 for verbatim hits.
 */
const BASE_SCALE = 0.85;

/** Minimum shared prefix length for the morphological-variant rule. */
const MIN_SHARED_PREFIX = 4;

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
 * Length of the common prefix shared by two tokens.
 */
function sharedPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) {
    index++;
  }
  return index;
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

  // Morphological variants: "decide"/"decision", "deploy"/"deployment".
  // These are 3-4 edits apart, and no edit budget wide enough to match them
  // is narrow enough to reject unrelated words. A shared prefix is.
  const sharedPrefix = sharedPrefixLength(queryToken, fieldToken);
  if (sharedPrefix >= MIN_SHARED_PREFIX) {
    const longest = Math.max(queryToken.length, fieldToken.length);
    return 0.55 + 0.25 * (sharedPrefix / longest);
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
 * Aggregation is mean(best score per query token) * coverage * BASE_SCALE,
 * plus PHRASE_BONUS when the full query appears verbatim. Coverage is the
 * fraction of query tokens that matched anything, and is what stops a
 * two-word query from ranking a document that matched only the common word.
 *
 * A field score reaches 1.0 only via the phrase bonus.
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
  let score = (total / queryTokens.length) * coverage * BASE_SCALE;

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
