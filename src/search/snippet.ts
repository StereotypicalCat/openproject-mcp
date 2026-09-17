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
