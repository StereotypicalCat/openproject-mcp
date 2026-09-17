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

/**
 * English function words carrying no retrieval signal.
 *
 * LLM queries are phrased as questions ("what did we decide about hiring"),
 * and the coverage multiplier in scoreField divides by the query token count.
 * Left in, these words drive coverage — and therefore the score — toward zero
 * for exactly the natural-language queries this feature exists to serve.
 */
const STOPWORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "had", "has", "have", "he",
  "her", "his", "how", "i", "if", "in", "is", "it", "its", "me", "my", "of",
  "on", "or", "our", "she", "should", "so", "than", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "to", "us", "was", "we",
  "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your",
]);

/**
 * Tokenizes a QUERY, stripping stopwords.
 *
 * Stopwords are kept when removing them would leave nothing, so that a query
 * such as "the who" still searches for something.
 */
export function tokenizeQuery(query: string): string[] {
  const tokens = tokenize(query);
  const meaningful = tokens.filter((token) => !STOPWORDS.has(token));
  return meaningful.length > 0 ? meaningful : tokens;
}
