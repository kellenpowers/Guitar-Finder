// ===== Comp relevance tunables =====
// A comp must share at least this fraction of the item's significant words,
// or it's discarded — this is what keeps guitar parts out of camera comps.
const MIN_TOKEN_OVERLAP = 0.4;
// The first couple of significant words are usually WHO made the item (brand,
// maker). A comp that shares none of them is a different product no matter how
// many generic words overlap — "4/4 violin with case and bow" is not a John
// Juzek violin, and pricing one off the other poisons the estimate.
const IDENTITY_TOKENS = 2;
const OVERLAP_WITHOUT_IDENTITY = 0.75; // near-total overlap can stand in for the lead words

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "with", "for", "of", "in", "on", "to",
  "new", "used", "like", "great", "good", "excellent", "condition", "obo",
]);

export function significantTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    ),
  ];
}

// Listing titles are messy ad copy; strip the noise down to the tokens worth
// searching comps with (capped so endless titles don't dilute matching).
const MARKETING_NOISE = new Set([
  "firm", "must", "sell", "selling", "sale", "deal", "bundle", "lot", "wow",
  "look", "price", "drop", "reduced", "today", "pickup", "local", "shipping",
  "free", "nice", "works", "working",
]);

export function normalizeQuery(title: string): string {
  return significantTokens(title)
    .filter((t) => !MARKETING_NOISE.has(t))
    .slice(0, 8)
    .join(" ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A model code like "ae-1" or "e10" — the token that actually identifies
// the product
function isModelCode(token: string): boolean {
  return /^[a-z]*\d[a-z0-9-]*$/.test(token);
}

// Short tokens and model codes must match as whole words: "ae" from
// "Canon AE-1" must not match "aerial". Longer words can substring-match.
function tokenMatches(token: string, title: string): boolean {
  if (token.length <= 3 || isModelCode(token)) {
    return new RegExp(`\\b${escapeRegex(token)}\\b`).test(title);
  }
  return title.includes(token);
}

// Keep only comps whose titles actually overlap the item's title. When the
// query carries a model code, a comp must match at least one of them; a comp
// must also match one of the query's lead (identity) words unless its overlap
// is near-total.
export function filterRelevant<T extends { title: string }>(
  query: string,
  comps: T[]
): T[] {
  const tokens = significantTokens(query);
  if (tokens.length === 0) return [];
  const modelCodes = tokens.filter(isModelCode);
  const identity = tokens.slice(0, IDENTITY_TOKENS);

  return comps.filter((c) => {
    const title = c.title.toLowerCase();
    if (modelCodes.length > 0 && !modelCodes.some((t) => tokenMatches(t, title))) {
      return false;
    }
    const hits = tokens.filter((t) => tokenMatches(t, title)).length;
    const overlap = hits / tokens.length;
    if (overlap < MIN_TOKEN_OVERLAP) return false;
    if (!identity.some((t) => tokenMatches(t, title)) && overlap < OVERLAP_WITHOUT_IDENTITY) {
      return false;
    }
    return true;
  });
}
