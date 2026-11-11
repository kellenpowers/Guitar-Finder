import { callCloud, fetchCloudInventory } from "./commands.js";
import {
  endEbayListing,
  reviseEbayQuantity,
  ebayItemIdFromUrl,
  reverbIdFromUrl,
} from "./ebay-lister.js";
import { endReverbListing } from "./reverb-lister.js";

// Owner-tapped takedown: he sold an item himself (a local cash sale, or
// anywhere the sold-sync watcher can't see) and marked it sold on the phone —
// end its live listings on both platforms (CLAUDE.md rule 1: owner-initiated
// action on his own listings via official APIs). Multi-unit aware: one unit of
// a shared eBay listing sells -> the quantity drops; the last unit ends it.

export interface TakedownPlan {
  reverbId: string; // "" = no Reverb listing to end
  ebay: { itemId: string; remaining: number } | null; // null = no eBay listing
}

// Pure, for tests: what taking down ONE item means for its platform listings,
// given every inventory row (siblings share the eBay listing).
export function planTakedown(items: Array<any>, inventoryId: string): TakedownPlan | null {
  const row = items.find((i) => i.id === inventoryId);
  if (!row) return null;
  const eid = ebayItemIdFromUrl(row.ebay_url);
  return {
    reverbId: reverbIdFromUrl(row.reverb_url),
    ebay: eid
      ? {
          itemId: eid,
          remaining: items.filter(
            (i) => i.id !== row.id && i.status === "listed" && ebayItemIdFromUrl(i.ebay_url) === eid
          ).length,
        }
      : null,
  };
}

export async function endListingsForItem(
  inventoryId: string
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  const items = await fetchCloudInventory();
  const plan = planTakedown(items, inventoryId);
  if (!plan) return { ok: false, error: "Item not found in inventory." };
  if (!plan.reverbId && !plan.ebay) {
    // Nothing live to take down — just record the sale
    await callCloud({ action: "update", id: inventoryId, status: "sold", sold_at: new Date().toISOString() }).catch(() => {});
    return { ok: true, detail: "No live listings on this item — marked sold." };
  }

  const done: string[] = [];
  let ok = true;

  if (plan.reverbId) {
    if (await endReverbListing(plan.reverbId)) done.push("Reverb listing ended");
    else {
      ok = false;
      done.push("Reverb takedown FAILED");
    }
  }

  if (plan.ebay) {
    const r =
      plan.ebay.remaining > 0
        ? await reviseEbayQuantity(plan.ebay.itemId, plan.ebay.remaining)
        : await endEbayListing(plan.ebay.itemId);
    // Already ended/closed counts as down — same leniency as sold-sync
    if (r.ok || /alread|has ended|closed|was not found/i.test(r.error || "")) {
      done.push(plan.ebay.remaining > 0 ? `eBay quantity set to ${plan.ebay.remaining}` : "eBay listing ended");
    } else {
      ok = false;
      done.push("eBay takedown FAILED");
    }
  }

  // Mark sold only after a confirmed takedown (the sold-sync rule) — money
  // fields stay blank: no platform order exists, and the books never guess.
  if (ok) {
    await callCloud({
      action: "update",
      id: inventoryId,
      status: "sold",
      sold_at: new Date().toISOString(),
    }).catch((err) => console.error("Takedown: couldn't mark item sold:", err));
  }

  return ok ? { ok, detail: done.join("; ") } : { ok, error: done.join("; ") };
}
