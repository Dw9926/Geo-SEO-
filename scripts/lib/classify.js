// Shared classifier for isolating "informational" and "conversational" search
// queries — the kind that surface in AI answer engines (Perplexity, Google AI
// Overviews, ChatGPT Search). Used by both the GSC pull and the audit.

// Interrogatives / openers that signal a question the user expects answered.
const QUESTION_OPENERS = [
  "how to",
  "how do",
  "how does",
  "how can",
  "how much",
  "how long",
  "what is",
  "what are",
  "what's",
  "whats",
  "why is",
  "why does",
  "why do",
  "when should",
  "when is",
  "where can",
  "where do",
  "which is",
  "who is",
  "can i",
  "can you",
  "do i need",
  "is it worth",
  "should i",
];

// Conversational / "near me" local-intent signals.
const CONVERSATIONAL_SIGNALS = [
  "near me",
  "best",
  "top",
  "cheapest",
  "affordable",
  "recommended",
  "vs",
  "versus",
  "alternative",
  "for beginners",
  "worth it",
];

const QUESTION_MARK = /\?/;

/**
 * Classify a single query string.
 * @param {string} rawQuery
 * @returns {{ query: string, isInformational: boolean, isConversational: boolean,
 *            matchedOpener: string|null, signals: string[], wordCount: number }}
 */
export function classifyQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  const q = query.toLowerCase();
  const wordCount = q ? q.split(/\s+/).length : 0;

  const matchedOpener =
    QUESTION_OPENERS.find((opener) => q.startsWith(opener) || q.includes(` ${opener} `)) || null;

  const signals = CONVERSATIONAL_SIGNALS.filter((s) => q.includes(s));

  // Long-tail conversational phrases (>= 5 words) read like natural language and
  // are disproportionately quoted by answer engines.
  const isLongTail = wordCount >= 5;

  const isInformational = Boolean(matchedOpener) || QUESTION_MARK.test(query);
  const isConversational = signals.length > 0 || isLongTail || isInformational;

  return {
    query,
    isInformational,
    isConversational,
    matchedOpener,
    signals,
    wordCount,
  };
}

/**
 * Filter + enrich a list of GSC query rows down to answer-engine opportunities.
 * @param {Array<{query:string, clicks?:number, impressions?:number, ctr?:number, position?:number}>} rows
 * @returns {Array} sorted opportunities (highest impressions first)
 */
export function extractOpportunities(rows) {
  return rows
    .map((row) => {
      const c = classifyQuery(row.query);
      return { ...row, ...c };
    })
    .filter((r) => r.isInformational || r.isConversational)
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
}
