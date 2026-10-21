import { callCloud, fetchCloudInventory } from "./commands.js";
import { ebayConnection, getEbayUserToken } from "./ebay-auth.js";
import {
  endEbayListing,
  reviseEbayQuantity,
  ebayItemIdFromUrl,
  reverbIdFromUrl,
} from "./ebay-lister.js";

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

// eBay sales as UNITS per listing id — one multi-quantity listing can sell
// several units, and each unit accounts for one inventory item
async function getEbaySoldUnits(): Promise<Map<string, number>> {
  const units = new Map<string, number>();
  if (!ebayConnection().connected) return units;
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
      return units;
    }
    const data = await res.json();
    for (const order of data?.orders || []) {
      // A cancelled order is not a sale — it must not take the other listing down
      const cancelState = order?.cancelStatus?.cancelState;
      if (cancelState && cancelState !== "NONE_REQUESTED") continue;
      for (const li of order?.lineItems || []) {
        if (!li?.legacyItemId) continue;
        const id = String(li.legacyItemId);
        units.set(id, (units.get(id) || 0) + (Number(li.quantity) || 1));
      }
    }
  } catch (err) {
    console.warn("Sold-sync: eBay check failed:", err instanceof Error ? err.message : err);
  }
  return units;
}

const REVERB_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/hal+json",
  "Accept-Version": "3.0",
});

// Reverb orders carry the listing id in different spots depending on the
// payload vintage — accept every known shape. Exported for tests.
export function reverbOrderListingId(order: any): string {
  if (order?.product_id) return String(order.product_id);
  if (order?.listing_id) return String(order.listing_id);
  const href = String(order?._links?.listing?.href || order?._links?.product?.href || "");
  const m = href.match(/listings\/(\d+)/);
  return m ? m[1] : "";
}

// A sale is an ORDER — that's the ground truth. The listings state check rides
// along as a second source, but orders are what we trust.
async function getReverbSoldIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const token = process.env.REVERB_API_TOKEN;
  if (!token) return ids;

  // Primary: the seller's orders
  try {
    for (let page = 1; page <= REVERB_SOLD_PAGES; page++) {
      const res = await fetch(
        `https://api.reverb.com/api/my/orders/selling/all?per_page=50&page=${page}`,
        { headers: REVERB_HEADERS(token) }
      );
      if (!res.ok) {
        console.warn(`Sold-sync: Reverb orders returned ${res.status}`);
        break;
      }
      const data = await res.json();
      const orders = data?.orders || [];
      for (const order of orders) {
        // A cancelled or refunded order is not a sale
        if (/cancel|refund/i.test(String(order?.status || ""))) continue;
        const id = reverbOrderListingId(order);
        if (id) ids.add(id);
      }
      if (orders.length < 50) break;
    }
  } catch (err) {
    console.warn("Sold-sync: Reverb orders check failed:", err instanceof Error ? err.message : err);
  }

  // Secondary: listings Reverb marks sold
  try {
    const res = await fetch(
      "https://api.reverb.com/api/my/listings?state=sold&per_page=50",
      { headers: REVERB_HEADERS(token) }
    );
    if (res.ok) {
      const data = await res.json();
      for (const l of data?.listings || []) {
        if (l?.id) ids.add(String(l.id));
      }
    }
  } catch {
    // orders are the source of truth; this one is best-effort
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

// One eBay listing can cover SEVERAL inventory items (a multi-unit listing of
// identical speakers, say), while each unit has its own Reverb listing. Items
// sharing an ebay_url form a group; a single item is just a group of one.
// Decide what one group needs this pass. Pure — exported for tests.
export interface GroupMember {
  id: string;
  status: string;
  rid: string; // Reverb listing id ("" if none)
}
export function planGroupSync(
  members: GroupMember[],
  ebayUnitsSoldInWindow: number,
  reverbSoldIds: Set<string>
): {
  markSoldViaReverb: GroupMember[]; // sold on Reverb — eBay quantity must drop
  markSoldViaEbay: GroupMember[]; // sold on eBay — their Reverb listings must end
  ebayQuantityTarget: number | null; // null = leave eBay alone this pass
} {
  const listed = members.filter((m) => m.status === "listed");
  const soldAlready = members.filter((m) => m.status === "sold");

  // Members that just sold on Reverb
  const viaReverb = listed.filter((m) => m.rid && reverbSoldIds.has(m.rid));

  // eBay units sold that aren't yet reflected by a sold member. Members that
  // sold on Reverb don't count against eBay's tally.
  const ebayAttributed = soldAlready.filter((m) => !(m.rid && reverbSoldIds.has(m.rid))).length;
  const newEbayUnits = Math.max(0, ebayUnitsSoldInWindow - ebayAttributed);
  const viaEbay = listed.filter((m) => !viaReverb.includes(m)).slice(0, newEbayUnits);

  // After this pass, this many units should remain available on eBay.
  // Only touch eBay when a Reverb sale changed the count — eBay tracks its
  // own sales by itself.
  const remaining = listed.length - viaReverb.length - viaEbay.length;
  const ebayQuantityTarget = viaReverb.length > 0 ? remaining : null;

  return { markSoldViaReverb: viaReverb, markSoldViaEbay: viaEbay, ebayQuantityTarget };
}

async function syncOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const items = await fetchCloudInventory().catch(() => [] as any[]);
    const relevant = items.filter((i) => i.ebay_url || i.reverb_url);
    if (relevant.filter((i) => i.status === "listed").length === 0) return;

    const [ebaySoldUnits, reverbSold] = await Promise.all([
      getEbaySoldUnits(),
      getReverbSoldIds(),
    ]);
    // Heartbeat — a silent watcher hid a missed sale once; never again
    console.log(
      `Sold-sync pass: ${relevant.filter((i) => i.status === "listed").length} listed items, ` +
        `${ebaySoldUnits.size} eBay listings with recent sales, ${reverbSold.size} Reverb sold ids.`
    );
    if (ebaySoldUnits.size === 0 && reverbSold.size === 0) return;

    // Group by shared eBay listing; items without one stand alone
    const groups = new Map<string, any[]>();
    for (const item of relevant) {
      const eid = ebayItemIdFromUrl(item.ebay_url);
      const key = eid || `solo:${item.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    for (const [key, groupItems] of groups) {
      const eid = key.startsWith("solo:") ? "" : key;
      const members: GroupMember[] = groupItems.map((i) => ({
        id: i.id,
        status: i.status,
        rid: reverbIdFromUrl(i.reverb_url),
      }));
      const plan = planGroupSync(members, eid ? ebaySoldUnits.get(eid) || 0 : 0, reverbSold);
      if (plan.markSoldViaReverb.length === 0 && plan.markSoldViaEbay.length === 0) continue;

      const byId = new Map(groupItems.map((i) => [i.id, i]));

      // Sold on eBay: end each unit's Reverb listing, then mark it sold.
      // A failed take-down leaves the item "listed" so the next pass retries.
      for (const m of plan.markSoldViaEbay) {
        console.log(`SOLD on eBay: "${byId.get(m.id)?.title}" — syncing Reverb.`);
        const endedOk = m.rid ? await endReverbListing(m.rid) : true;
        if (endedOk) {
          await callCloud({ action: "update", id: m.id, status: "sold" }).catch((err) =>
            console.error("Sold-sync: couldn't mark item sold in inventory:", err)
          );
        }
      }

      // Sold on Reverb: shrink (or end) the shared eBay listing, then mark sold
      if (plan.markSoldViaReverb.length > 0) {
        let ebayOk = true;
        if (eid && plan.ebayQuantityTarget !== null) {
          const result =
            plan.ebayQuantityTarget <= 0
              ? await endEbayListing(eid)
              : await reviseEbayQuantity(eid, plan.ebayQuantityTarget);
          // "already ended/closed" still counts as down
          ebayOk = result.ok || /alread|has ended|closed/i.test(result.error || "");
        }
        for (const m of plan.markSoldViaReverb) {
          console.log(`SOLD on Reverb: "${byId.get(m.id)?.title}" — syncing eBay.`);
          if (ebayOk) {
            await callCloud({ action: "update", id: m.id, status: "sold" }).catch((err) =>
              console.error("Sold-sync: couldn't mark item sold in inventory:", err)
            );
          }
        }
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
