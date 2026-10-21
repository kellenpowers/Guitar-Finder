// A description that states a price goes stale the moment the price changes —
// and the eBay price is auto-raised above the Reverb/target price to cover
// fees, so a price sentence written earlier is ALWAYS wrong there. Both
// platforms display the real price prominently, so stating it again in the
// text only creates contradictions. Price-talk sentences are removed before
// a listing is created.
//
// What must SURVIVE: prices in other roles — history ("I paid $450 shipped"),
// retail/market comparisons ("these go for $600 shipped", "others are asking
// $700"), included-value ("comes with $100 of cables"), and specs that happen
// to contain numbers ("will take 300 watts").

// A dollar amount: $450, $1,299.99
const AMOUNT = String.raw`\$\s?\d[\d,]*(?:\.\d+)?`;
// A bare number only counts as a price when it can't be much else: 2+ digits,
// not glued to a word ("1960s", "212R"), and not starting mid-number or right
// after a "$" (those belong to AMOUNT and its guards)
const BARE = String.raw`(?<![\d,.$])\d{2,}[\d,]*(?:\.\d+)?(?!\w)`;
const AMOUNT_OR_BARE = `(?:${AMOUNT}|${BARE})`;
// Sellers hedge between keyword and number: "asking only $450", "a firm $450",
// "looking to get around $500" (letters only, so it can't swallow the number)
const FILLER = String.raw`(?:[a-z']+\s+){0,2}`;
// Someone ELSE's price is market context, not our asking price:
// "these are selling for $600", "others are asking $700", "people keep asking"
const THIRD_PARTY = String.raw`(?<!\b(?:these|those|they|others?|some|most|people|everyone|similar)[\w']*\s+(?:[\w']+\s+)?)`;
// History and comparisons give themselves away with the word right before the
// amount: "paid $450 shipped", "bought it for $450 cash", "retailed for $899
// shipped", "was/worth/about/over $X". ("for" is safe to exclude here — every
// asking form that uses "for" has its own keyword pattern below.)
// (the optional \$ keeps the bare-number alternative from matching "450"
// inside "paid $450" and sidestepping this guard)
const HISTORY = String.raw`(?<!\b(?:for|paid|bought|cost|costs|was|were|worth|new|about|around|over|under|at)\s\$?\s?)`;

// Sentences that STATE the sale price. Each pattern needs both a selling
// signal and a number.
const PRICE_TALK_RES: RegExp[] = [
  // "Asking $450", "asking price is 450", "asking for $550", "I'm asking only 450 shipped"
  new RegExp(
    String.raw`${THIRD_PARTY}\b(i'?m\s+)?asking(\s+price)?(\s+for)?(\s+is|:)?\s*${FILLER}${AMOUNT_OR_BARE}`,
    "i"
  ),
  // "$450 OBO", "450 shipped, PayPal only", "$450 plus shipping", "$450 firm",
  // "$450 cash", "$450 takes it", "$450 is the price"
  new RegExp(
    String.raw`${HISTORY}${AMOUNT_OR_BARE}\s*(obo\b|o\.b\.o\.?|or best offer|firm\b|shipped\b|plus\s+shipping|\+\s*shipping|cash\b|takes\s+it|is\s+the\s+price)`,
    "i"
  ),
  // Price-labeled statements — bare numbers allowed: "Price is 450 shipped",
  // "Priced at $450", "Firm at $450"
  new RegExp(String.raw`\b(price(\s+is|:)|priced\s+at|firm\s+at)\s*${FILLER}${AMOUNT_OR_BARE}`, "i"),
  // First-person selling verbs — "$" required so specs survive ("will take
  // 300 watts"): "selling for $450", "would sell for $450", "I'll take $450",
  // "I want $450", "yours for $99", "let it go for $300", "looking to get
  // $500", "listing for $450" / "listing it at $450"
  new RegExp(
    String.raw`${THIRD_PARTY}\b(selling(\s+it)?\s+for|(would|will|can|could)\s+sell\s+(it\s+)?for|sell\s+it\s+for|will\s+take|i'?ll\s+take|i'?d\s+take|i\s+want|yours\s+for|let(ting)?\s+(it|this)\s+go\s+(for|at)|looking\s+(to\s+get|for)|listing(\s+(it|this|one|them))?\s+(for|at))\s*${FILLER}${AMOUNT}`,
    "i"
  ),
  // Stale-price phrasings that go wrong the moment the price changes:
  // "on sale for $450", "sale price $450", "reduced to $450", "was $800, now $450"
  new RegExp(
    String.raw`\b(on\s+sale\s+for|sale\s+price:?|reduced\s+to|dropped\s+to|marked\s+down\s+to|now\s+(just\s+|only\s+)?)\s*${FILLER}${AMOUNT}`,
    "i"
  ),
  // A line or sentence that is nothing but a price
  new RegExp(String.raw`^\s*${AMOUNT}\s*\.?\s*$`, "i"),
];

function isPriceTalk(sentence: string): boolean {
  const s = sentence.replace(/[‘’]/g, "'"); // phone keyboards type ’
  return PRICE_TALK_RES.some((re) => re.test(s));
}

// Remove the sentences that state the sale price, keep everything else.
// Works line by line, then sentence by sentence within a line, so one price
// sentence in the middle of an imported Reverb paragraph doesn't take the
// paragraph with it.
export function removePriceTalk(text: string): string {
  const lines = (text || "").split("\n").map((line) => {
    if (!line.trim()) return line;
    if (!isPriceTalk(line)) return line;
    // Sentence boundary = .!? followed by whitespace — NEVER the decimal
    // point inside "$449.99" (splitting there once left "99 OBO." behind,
    // publishing a brand-new wrong price)
    const sentences = line.split(/(?<=[.!?])(?=\s)/);
    return sentences
      .filter((s) => !isPriceTalk(s))
      .join("")
      .trim();
  });

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // dropped lines shouldn't leave big gaps
    .trim();
}
