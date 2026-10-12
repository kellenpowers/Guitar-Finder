import { callCloud } from "./commands.js";

// Imports the owner's LIVE Reverb listings into the cloud inventory so they
// can be cross-listed to eBay (with fee-adjusted pricing) when that's live.

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function importReverbListings(): Promise<{ imported: number; updated: number }> {
  const token = process.env.REVERB_API_TOKEN;
  if (!token) throw new Error("REVERB_API_TOKEN not set on the Mac");

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/hal+json",
    Accept: "application/hal+json",
    "Accept-Version": "3.0",
  };

  const items: any[] = [];
  let page = 1;
  while (page <= 5) {
    const res = await fetch(
      `https://api.reverb.com/api/my/listings?state=live&per_page=50&page=${page}`,
      { headers }
    );
    if (!res.ok) throw new Error(`Reverb my/listings ${res.status}`);
    const data = await res.json();
    const listings = data?.listings || [];
    for (const l of listings) {
      const photos = (l.photos || [])
        .map((p: any) => p?._links?.full?.href || p?._links?.large_crop?.href || p?._links?.thumbnail?.href)
        .filter(Boolean);
      items.push({
        title: l.title || `${l.make || ""} ${l.model || ""}`.trim() || "Reverb listing",
        status: "listed",
        target_price: l.price?.amount ? parseFloat(l.price.amount) : null,
        photos,
        listing_draft: stripHtml(l.description || ""),
        reverb_url: l._links?.web?.href || null,
      });
    }
    if (listings.length < 50) break;
    page++;
  }

  if (items.length === 0) return { imported: 0, updated: 0 };
  const result = await callCloud({ action: "bulkUpsert", items });
  console.log(
    `Reverb import: ${result.created} new, ${result.updated} updated (${items.length} live listings).`
  );
  return { imported: result.created ?? 0, updated: result.updated ?? 0 };
}
