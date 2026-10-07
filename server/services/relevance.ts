// ===== Comp relevance tunables =====
// A comp must share at least this fraction of the item's significant words,
// or it's discarded — this is what keeps guitar parts out of camera comps.
const MIN_TOKEN_OVERLAP = 0.4;

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

// Keep only comps whose titles actually overlap the item's title.
export function filterRelevant<T extends { title: string }>(
  query: string,
  comps: T[]
): T[] {
  const tokens = significantTokens(query);
  if (tokens.length === 0) return [];

  return comps.filter((c) => {
    const title = c.title.toLowerCase();
    const hits = tokens.filter((t) => title.includes(t)).length;
    return hits / tokens.length >= MIN_TOKEN_OVERLAP;
  });
}
