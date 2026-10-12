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
