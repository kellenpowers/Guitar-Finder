import { callCloud, fetchCloudInventory } from "./commands.js";
import { ebayConnection, getEbayUserToken } from "./ebay-auth.js";
import { endEbayListing, ebayItemIdFromUrl, reverbIdFromUrl } from "./ebay-lister.js";

// The don't-double-sell watcher. Every few minutes: check both platforms'
// sold items; when an inventory item sells on one platform, END its duplicate
// listing on the other (the one pre-authorized automatic action, CLAUDE.md
// rule 1) and mark the item sold.

// ===== Sold-sync tunables =====
const SYNC_INTERVAL_MS = 10 * 60_000; // check every 10 minutes
// Wide on purpose: if the Mac is off for days when something sells, the sale
// must still be inside the window when it comes back (it once sat off for 2
// days). Re-checking old sales is free — items already marked sold are skipped.
const ORDER_LOOKBACK_DAYS = 14;
const REVERB_SOLD_PAGES = 3; // newest 150 sold listings — plenty of history

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
      // A cancelled order is not a sale — it must not take the other listing down
      const cancelState = order?.cancelStatus?.cancelState;
      if (cancelState && cancelState !== "NONE_REQUESTED") continue;
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
    for (let page = 1; page <= REVERB_SOLD_PAGES; page++) {
      const res = await fetch(
        `https://api.reverb.com/api/my/listings?state=sold&per_page=50&page=${page}`,
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
      const listings = data?.listings || [];
      for (const l of listings) {
        if (l?.id) ids.add(String(l.id));
      }
      if (listings.length < 50) break;
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
  // Already gone (ended by hand, or sold there too) counts as done
  if (res.status === 404 || res.status === 422) {
    console.log(`Reverb listing ${listingId} was already ended/gone — nothing to take down.`);
    return true;
  }
  console.error(
    `FAILED to end Reverb listing ${listingId} (${res.status}) — will retry in 10 minutes. If this repeats, END IT MANUALLY ON REVERB.`
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

      const where =
        soldOnEbay && soldOnReverb ? "BOTH platforms" : soldOnEbay ? "eBay" : "Reverb";
      console.log(`SOLD on ${where}: "${item.title}" — syncing the other platform.`);

      // Only mark the item sold once the duplicate is actually down — a failed
      // take-down leaves it "listed" so the next pass retries automatically
      let endedOk = true;
      if (soldOnEbay && rid && !soldOnReverb) {
        endedOk = (await endReverbListing(rid)) && endedOk;
      }
      if (soldOnReverb && eid && !soldOnEbay) {
        const result = await endEbayListing(eid);
        // eBay phrases "already ended" as an error — that still counts as down
        endedOk = (result.ok || /alread|has ended|closed/i.test(result.error || "")) && endedOk;
      }

      if (endedOk) {
        await callCloud({ action: "update", id: item.id, status: "sold" }).catch((err) =>
          console.error("Sold-sync: couldn't mark item sold in inventory:", err)
        );
      }
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
