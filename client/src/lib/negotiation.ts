// Seller-message drafting per the owner's negotiation spec (Chris Voss, light):
// STRUCTURE: greeting -> expectation-lowering line (verbatim) -> one genuine
// label about the item (or a politely named flaw) -> one calibrated question
// that matters for value -> the offer stated as a fact ("I can do $X cash").
// RULES: casual but properly punctuated; no em dashes; no emojis; no pressure
// or fake urgency; never promise flexible pickup ("this week" is fine); on
// Facebook/OfferUp never name the item (the listing is attached), on
// Craigslist always name it; liquidation/bundle sellers get a bundle ask; if
// a key fact is unknown (no market value, or bundle contents), ask first and
// offer in the next message; follow-ups skip the greeting and start with
// "Still interested." The counter ladder is PRIVATE and never enters the text.

// ===== Negotiation tunables =====
const MIN_PROFIT_FLOOR = 40; // walk-away still keeps at least this much profit
const LOWBALL_FLOOR_RATIO = 0.35; // if our max is under this fraction of asking, the deal is dead
const NO_VALUE_CAP_RATIO = 0.85; // max spend vs asking when no market value known
const ACKERMAN_STEPS = [0.65, 0.85, 0.95]; // Voss ladder: shrinking raises to max
// Mirror of server/services/profit.ts constants (keep in sync)
const RESALE_FEE_PCT = 0.13;
const SHIPPING_EST = 25;
const DRIVE_COST_PER_MILE = 0.65;

// Continues the greeting ("Hey Mick, fair warning, ...") per the owner's examples
const EXPECTATION_LINE =
  "fair warning, my number's probably lower than you're hoping for, and I totally get it if it doesn't work.";

const NEEDS_WORK_RE =
  /(for parts|as.?is\b|broken|needs? (repair|work|fixing)|not working|doesn'?t (work|power|turn)|cracked|damaged|untested)/i;
const BUNDLE_RE =
  /(liquidat|closing|going out of business|estate sale|moving sale|everything must go|sell(ing)? it all|whole lot|entire (collection|inventory|studio)|downsizing)/i;

export interface NegotiationListing {
  title: string;
  price: number;
  source: string;
  estimated_market_value?: number | null;
  distance_miles?: number | null;
}

export interface CounterLadder {
  steps: number[]; // opening offer, then raises in shrinking increments
  walkAway: number; // above this, walk
}

const r5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);

export function counterLadder(l: NegotiationListing): CounterLadder | null {
  if (!l.price || l.price <= 0) return null;

  // Never pay more than keeps MIN_PROFIT_FLOOR after fees, shipping, and the
  // drive; and never above asking. Without a market value, cap below asking.
  let cap = l.price;
  if (l.estimated_market_value && l.estimated_market_value > 0) {
    const drive = 2 * (l.distance_miles ?? 0) * DRIVE_COST_PER_MILE;
    const profitCap =
      l.estimated_market_value * (1 - RESALE_FEE_PCT) -
      SHIPPING_EST -
      drive -
      MIN_PROFIT_FLOOR;
    cap = Math.min(cap, profitCap);
  } else {
    cap = cap * NO_VALUE_CAP_RATIO;
  }
  if (cap < 10) return null; // the math says this flip doesn't work
  // Offering a tiny fraction of asking isn't a negotiation, it's a dead deal
  if (cap < l.price * LOWBALL_FLOOR_RATIO) return null;

  let final = Math.floor(cap);
  // End on a specific, non-round number — but don't butcher tiny budgets
  // (a $10 cap must not become $5)
  if (final % 10 === 0) final -= final >= 40 ? 5 : 1;

  if (final < 40) {
    // Cheap item: a four-rung ladder is silly, offer the number
    return { steps: [final], walkAway: final };
  }

  let s3 = Math.min(r5(final * ACKERMAN_STEPS[2]), final - 5);
  let s2 = Math.min(r5(final * ACKERMAN_STEPS[1]), s3 - 5);
  let s1 = Math.min(r5(final * ACKERMAN_STEPS[0]), s2 - 5);
  if (s1 < 5) return { steps: [final], walkAway: final };

  // Raises must shrink: rounding + clamping can make the last raise grow
  // (e.g. [45, 60, 65, 71]); split the gap when it does
  if (final - s3 > s3 - s2) s3 = Math.round((final + s2) / 2);
  if (s3 - s2 > s2 - s1) s2 = Math.round((s3 + s1) / 2);

  return { steps: [s1, s2, s3, final], walkAway: final };
}

// First six words of the title, for Craigslist messages (nothing is attached
// there, so the item must be named)
const DANGLING_WORDS = new Set(["and", "or", "with", "plus", "for", "the", "a", "an"]);

// Seller titles are ad copy: emojis, em dashes, ALL CAPS, their own price.
// None of that may leak into our message (and echoing their price undercuts
// the low anchor).
function sanitizeTitle(title: string): string {
  const cleaned = title
    .replace(/[–—]/g, " ") // en/em dashes — banned in our messages
    .replace(/\$\s?\d[\d,.]*/g, " ") // the seller's asking price
    .replace(/\b(obo|o\.b\.o\.?|firm|must see|must sell|look|wow)\b/gi, " ")
    .replace(/[^\w\s,.'"&/+-]/g, " ") // emojis and decoration
    .replace(/\s+/g, " ")
    .trim();
  // Tame ALL-CAPS shouting but keep short model codes (SM7B, DJI)
  return cleaned
    .split(" ")
    .map((w) =>
      w.length > 3 && /^[A-Z]{4,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w
    )
    .join(" ");
}

export function shortItemName(title: string): string {
  const words = sanitizeTitle(title).split(/\s+/).filter(Boolean).slice(0, 6);
  // Don't end mid-phrase ("exam tables and")
  while (
    words.length > 1 &&
    DANGLING_WORDS.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ""))
  ) {
    words.pop();
  }
  return words.join(" ").replace(/[,;:!.?'"]+$/, "");
}

export function draftSellerMessage(
  l: NegotiationListing,
  opts: { followUp?: boolean } = {}
): string {
  const ladder = counterLadder(l);
  const needsWork = NEEDS_WORK_RE.test(l.title);
  const bundle = BUNDLE_RE.test(l.title);
  const onCraigslist = l.source === "craigslist";
  // Offer only when we know enough to anchor; otherwise ask first and offer
  // in the next message
  const askFirst = bundle || !ladder || !l.estimated_market_value;

  const offerLine = askFirst
    ? "Happy to make a cash offer once I know a bit more."
    : `I can do $${ladder!.steps[0]} cash.`;

  if (opts.followUp) {
    return `Still interested. ${offerLine}`;
  }

  const greeting = onCraigslist ? "Hey," : "Hey [name],";

  const itemName = shortItemName(l.title);
  const clIntro = itemName
    ? `I'm interested in the ${itemName}.`
    : "I'm interested in what you listed.";

  let label: string;
  let question: string;
  if (bundle) {
    label = onCraigslist
      ? itemName
        ? `I'm interested in your "${itemName}" listing and possibly more as a bundle.`
        : "I'm interested in what you're selling and possibly more as a bundle."
      : "I'd be interested in a bundle if you're selling more than this.";
    question =
      "What else do you have that isn't listed yet, and could you send brands and models?";
  } else if (needsWork) {
    label = onCraigslist
      ? `${clIntro} Sounds like it needs a little work, which is fine by me.`
      : "Sounds like it needs a little work, which is fine by me.";
    question = "What exactly is going on with it, and do any parts or accessories come with it?";
  } else {
    label = onCraigslist
      ? `${clIntro} Looks like it's been well kept.`
      : "Looks like it's been well kept.";
    question = "Does everything work like it should, and does anything extra come with it?";
  }

  return `${greeting} ${EXPECTATION_LINE} ${label} ${question} ${offerLine}`;
}
