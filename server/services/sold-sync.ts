import { callCloud, fetchCloudInventory } from "./commands.js";
import { ebayConnection, getEbayUserToken } from "./ebay-auth.js";
import { endEbayListing, ebayItemIdFromUrl, reverbIdFromUrl } from "./ebay-lister.js";

// The don't-double-sell watcher. Every few minutes: check both platforms'
// sold items; when an inventory item sells on one platform, END its duplicate
// listing on the other (the one pre-authorized automatic action, CLAUDE.md
// rule 1) and mark the item sold.

// ===== Sold-sync tunables =====
const SYNC_INTERVAL_MS = 10 * 60_000; // check every 10 minutes
const ORDER_LOOKBACK_DAYS = 3;

let running = false;

async function getEbaySoldItemIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!ebayConnection().connected) return ids;
  try {
    const token = await getEbayUserToken();
    const since = new Date(Date.now() - ORDER_LOOKBACK_DAYS * 86_400_000).toISOString();
    const filter = encodeURIComponent(`creationdate:[${since}..]`);
    const res = await fetch(
      `https://api.ebay.com/sell/fulfillment/v1/order?filter=${filter}&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      console.warn(`Sold-sync: eBay orders returned ${res.status}`);
      return ids;
    }
    const data = await res.json();
    for (const order of data?.orders || []) {
      for (const li of order?.lineItems || []) {
        if (li?.legacyItemId) ids.add(String(li.legacyItemId));
      }
    }
  } catch (err) {
    console.warn("Sold-sync: eBay check failed:", err instanceof Error ? err.message : err);
  }
  return ids;
}

async function getReverbSoldIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const token = process.env.REVERB_API_TOKEN;
  if (!token) return ids;
  try {
    const res = await fetch(
      "https://api.reverb.com/api/my/listings?state=sold&per_page=50",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/hal+json",
          "Accept-Version": "3.0",
        },
      }
    );
    if (!res.ok) {
      console.warn(`Sold-sync: Reverb listings returned ${res.status}`);
      return ids;
    }
    const data = await res.json();
    for (const l of data?.listings || []) {
      if (l?.id) ids.add(String(l.id));
    }
  } catch (err) {
    console.warn("Sold-sync: Reverb check failed:", err instanceof Error ? err.message : err);
  }
  return ids;
}

async function endReverbListing(listingId: string): Promise<boolean> {
  const token = process.env.REVERB_API_TOKEN;
  if (!token) return false;
  const res = await fetch(
    `https://api.reverb.com/api/my/listings/${listingId}/state/end`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/hal+json",
        Accept: "application/hal+json",
        "Accept-Version": "3.0",
      },
      body: JSON.stringify({ reason: "not_sold" }),
    }
  );
  if (res.ok) {
    console.log(`Reverb listing ${listingId} ended (sold elsewhere).`);
    return true;
  }
  console.error(
    `FAILED to end Reverb listing ${listingId} (${res.status}) — END IT MANUALLY ON REVERB.`
  );
  return false;
}

async function syncOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Items currently listed somewhere, from the cloud inventory
    const items = await fetchCloudInventory().catch(() => [] as any[]);
    const listed = items.filter(
      (i) => i.status === "listed" && (i.ebay_url || i.reverb_url)
    );
    if (listed.length === 0) return;

    const [ebaySold, reverbSold] = await Promise.all([
      getEbaySoldItemIds(),
      getReverbSoldIds(),
    ]);
    if (ebaySold.size === 0 && reverbSold.size === 0) return;

    for (const item of listed) {
      const eid = ebayItemIdFromUrl(item.ebay_url);
      const rid = reverbIdFromUrl(item.reverb_url);
      const soldOnEbay = !!eid && ebaySold.has(eid);
      const soldOnReverb = !!rid && reverbSold.has(rid);
      if (!soldOnEbay && !soldOnReverb) continue;

      const where = soldOnEbay ? "eBay" : "Reverb";
      console.log(`SOLD on ${where}: "${item.title}" — syncing the other platform.`);

      if (soldOnEbay && rid) await endReverbListing(rid);
      if (soldOnReverb && eid) await endEbayListing(eid);

      await callCloud({ action: "update", id: item.id, status: "sold" }).catch((err) =>
        console.error("Sold-sync: couldn't mark item sold in inventory:", err)
      );
    }
  } finally {
    running = false;
  }
}

export function startSoldSync(): void {
  if (!process.env.PUBLISH_KEY || !process.env.PUBLISH_URL) return;
  setInterval(() => {
    syncOnce().catch((err) => console.error("Sold-sync failed:", err));
  }, SYNC_INTERVAL_MS);
  setTimeout(() => syncOnce().catch(() => {}), 30_000);
  console.log("Sold-sync watcher started (both platforms, every 10 minutes).");
}
