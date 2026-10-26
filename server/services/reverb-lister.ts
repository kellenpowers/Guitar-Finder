import { removePriceTalk } from "./listing-text.js";

// Creates DRAFT listings on Reverb through its official API, at the owner's
// explicit request (CLAUDE.md hard rule 1, owner's Oct 2026 decision).
// Drafts, not live listings: the owner reviews and taps Publish on Reverb.

// ===== Listing tunables =====
const LISTING_CONDITION_SLUG = "good"; // default condition for drafts
const PUBLISH_IMMEDIATELY = false; // keep false until field mapping is proven

export interface ReverbListingRequest {
  title: string;
  price: number | null;
  description: string;
  photoUrls: string[];
  videoUrl?: string | null;
}

export interface ReverbListingResult {
  ok: boolean;
  url?: string;
  error?: string;
}

const REVERB_API_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/hal+json",
  Accept: "application/hal+json",
  "Accept-Version": "3.0",
});

// Change the asking price of one of the owner's live listings (owner-tapped
// from the phone, or the repricing autopilot inside its margin bounds —
// CLAUDE.md rule 1).
export async function updateReverbPrice(
  listingId: string,
  price: number
): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  const token = process.env.REVERB_API_TOKEN;
  if (!token) return { ok: false, error: "REVERB_API_TOKEN not set on the Mac" };
  if (!(price > 0)) return { ok: false, error: "price must be above 0" };
  const res = await fetch(`https://api.reverb.com/api/listings/${listingId}`, {
    method: "PUT",
    headers: REVERB_API_HEADERS(token),
    body: JSON.stringify({ price: { amount: price.toFixed(2), currency: "USD" } }),
  });
  if (res.ok) {
    console.log(`Reverb listing ${listingId} price set to $${price.toFixed(2)}.`);
    return { ok: true };
  }
  const text = await res.text().catch(() => "");
  // Ended or sold mid-flight: not an error to retry — sold-sync owns it
  if (res.status === 404 || /ended|sold|not live/i.test(text)) {
    console.log(`Reverb listing ${listingId} is no longer live — skipping its price change.`);
    return { ok: false, gone: true, error: `Reverb ${res.status}` };
  }
  console.error(`FAILED to change Reverb listing ${listingId} price (${res.status}): ${text.slice(0, 200)}`);
  return { ok: false, error: `Reverb ${res.status}: ${text.slice(0, 150)}` };
}

// Engagement stats for the owner's LIVE listings, keyed by listing id. Reverb
// returns watcher/view counts on the seller's own listings; fields it doesn't
// send stay null (unknown), never zero.
export async function fetchReverbEngagement(): Promise<
  Map<string, { views: number | null; watches: number | null }>
> {
  const map = new Map<string, { views: number | null; watches: number | null }>();
  const token = process.env.REVERB_API_TOKEN;
  if (!token) return map;
  try {
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(
        `https://api.reverb.com/api/my/listings?state=live&per_page=50&page=${page}`,
        { headers: REVERB_API_HEADERS(token) }
      );
      if (!res.ok) {
        console.warn(`Repricer: Reverb my/listings returned ${res.status}`);
        break;
      }
      const data = await res.json();
      const listings = data?.listings || [];
      for (const l of listings) {
        if (!l?.id) continue;
        const stats = l.stats || l.counts || {};
        const views = Number(stats.views ?? stats.view_count ?? NaN);
        const watches = Number(stats.watches ?? stats.watchers ?? stats.watch_count ?? NaN);
        map.set(String(l.id), {
          views: Number.isFinite(views) ? views : null,
          watches: Number.isFinite(watches) ? watches : null,
        });
      }
      if (listings.length < 50) break;
    }
  } catch (err) {
    console.warn("Repricer: Reverb engagement fetch failed:", err instanceof Error ? err.message : err);
  }
  return map;
}

export async function createReverbDraft(
  req: ReverbListingRequest
): Promise<ReverbListingResult> {
  const token = process.env.REVERB_API_TOKEN;
  if (!token) return { ok: false, error: "REVERB_API_TOKEN not set on the Mac" };

  // Reverb wants make/model; a naive split beats omitting them for drafts
  const words = req.title.trim().split(/\s+/);
  const make = words[0] || "Unknown";
  const model = words.slice(1).join(" ") || req.title;

  // Reverb shows the price itself; a price written into the text goes stale
  // the moment the price changes, so strip price-talk sentences
  const description = removePriceTalk(req.description) || req.title;

  const body: Record<string, unknown> = {
    title: req.title.slice(0, 80),
    make,
    model,
    description,
    condition: { slug: LISTING_CONDITION_SLUG },
    photos: req.photoUrls,
    publish: PUBLISH_IMMEDIATELY,
  };
  if (req.price && req.price > 0) {
    body.price = { amount: req.price.toFixed(2), currency: "USD" };
  }
  if (req.videoUrl && /youtu\.?be/.test(req.videoUrl)) {
    body.youtube_video_url = req.videoUrl;
  }

  const res = await fetch("https://api.reverb.com/api/listings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/hal+json",
      Accept: "application/hal+json",
      "Accept-Version": "3.0",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Reverb listing create failed (${res.status}): ${text.slice(0, 300)}`);
    return { ok: false, error: `Reverb ${res.status}: ${text.slice(0, 200)}` };
  }

  let url: string | undefined;
  try {
    const data = JSON.parse(text);
    url =
      data?.listing?._links?.web?.href ||
      data?._links?.web?.href ||
      (data?.listing?.id || data?.id
        ? `https://reverb.com/my/selling/drafts`
        : undefined);
  } catch {
    // created but response unparseable — point at the drafts page
    url = "https://reverb.com/my/selling/drafts";
  }
  console.log(`Reverb draft created for "${req.title}".`);
  return { ok: true, url: url || "https://reverb.com/my/selling/drafts" };
}
