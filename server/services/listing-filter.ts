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
  ].join("|"),
  "i"
);

export function isServiceAd(title: string): boolean {
  return SERVICE_AD_RE.test(title);
}

export function isJunkListing(title: string, price: number): boolean {
  return price < KEEP_PRICE_MIN || isServiceAd(title);
}
