// ===== Junk-listing filter (tunables) =====
// People advertise SERVICES as $0/$1 "items" — lawn care, junk removal,
// we-buy-anything. Those never belong in a flip pipeline.
export const KEEP_PRICE_MIN = 15; // below this, it's a freebie/service ad/not worth a drive

// Strong service-ad phrases. Deliberately conservative: generic words like
// "service" alone would kill real items ("service manual").
const SERVICE_AD_RE = new RegExp(
  [
    "we buy",
    "cash for (your|all|junk|cars|houses)",
    "free estimates?",
    "free quotes?",
    "licensed (and|&) insured",
    "junk removal",
    "junk haul",
    "hauling (service|available)",
    "we haul",
    "lawn (care|service|mowing)",
    "landscaping", // NOT "landscap" — that would kill landscape paintings
    "pressure washing", // NOT "pressure wash" — that would kill pressure washers for sale
    "power washing",
    "handyman",
    "tree (removal|trimming|service)",
    "gutter cleaning",
    "roofing",
    "roof (repair|replacement)",
    "appliance (repair|installation)",
    "pest control",
    "free consultation",
    "same.day service",
    "notary",
    "tax (prep|preparation|services)",
    "repair (service|shop|services)",
    "we (fix|repair|install|come to you)",
    "mobile (mechanic|detailing|notary)",
    "cleaning service",
    "house cleaning",
    "moving service",
    "movers available",
    "dj services?",
    "photo ?booth",
    "rent to own",
    "financing available",
    "no credit check",
    "call or text (now|today)",
    // Rentals: the price is a day rate, not a sale ("Dump trailer rental")
    "for rent",
    "\\brentals?\\b",
    // Locksmith/car-key ads: the photos are key-cutting machines, the "price"
    // is a service call ("All Car smart Keys, remotes, fobs")
    "locksmith",
    "(all|any) (car|auto|vehicle)s? ?(smart )?(keys?|fobs?|remotes?)",
    "keys?,? ?remotes?,? ?(and |& )?fobs?",
    "keys? (made|cut|copied|programmed)",
    "key (cutting|programming|duplication|replacement)",
  ].join("|"),
  "i"
);

export function isServiceAd(title: string): boolean {
  return SERVICE_AD_RE.test(title);
}

export function isJunkListing(title: string, price: number): boolean {
  return price < KEEP_PRICE_MIN || isServiceAd(title);
}

// ===== Repeated-ad spam (tunables) =====
// The same distinctive title posted again and again in DIFFERENT places is a
// service ad blasted at every city (the key-fob locksmith pattern), not five
// identical items for sale. Short generic titles ("Electric guitar") repeat
// naturally and are left alone.
export const REPEAT_AD_MIN_COPIES = 3;
export const REPEAT_AD_MIN_TITLE_LEN = 20;

// Pure, for tests: which (lowercased, trimmed) titles in this set are spam.
export function repeatedAdTitles(
  rows: { title: string; location?: string | null }[]
): Set<string> {
  const copies = new Map<string, number>();
  const places = new Map<string, Set<string>>();
  for (const r of rows) {
    const t = r.title.trim().toLowerCase();
    if (t.length < REPEAT_AD_MIN_TITLE_LEN) continue;
    copies.set(t, (copies.get(t) || 0) + 1);
    if (!places.has(t)) places.set(t, new Set());
    if (r.location) places.get(t)!.add(r.location.trim().toLowerCase());
  }
  const spam = new Set<string>();
  for (const [t, n] of copies) {
    if (n >= REPEAT_AD_MIN_COPIES && (places.get(t)?.size || 0) >= 2) spam.add(t);
  }
  return spam;
}
