import cron from "node-cron";
import { callCloud, fetchCloudInventory } from "./commands.js";
import { planReprice, groupBounds, floorFor, type BoundsMember, type GroupBounds } from "./pricing.js";
import { ebayConnection } from "./ebay-auth.js";
import {
  reviseEbayPrice,
  getEbayWatchCount,
  ebayItemIdFromUrl,
  reverbIdFromUrl,
  ebayAskPrice,
} from "./ebay-lister.js";
import { updateReverbPrice, fetchReverbEngagement } from "./reverb-lister.js";

// The repricing autopilot. Once a day: read engagement (views/watchers) off
// both platforms, decide per listing whether the price moves (pricing.ts holds
// the policy and the margin floors), and apply the change to Reverb and eBay.
// Owner's standing authorization, Oct 26 2026 — recorded in CLAUDE.md rule 1.

// ===== Repricer tunables =====
const REPRICE_CRON = "15 10 * * *"; // daily pass at 10:15am (owner sees changes in the morning)
const STARTUP_DELAY_MS = 3 * 60_000; // one pass shortly after boot (idempotent — cadence anchors gate re-runs)
const EBAY_WATCH_CAP = 40; // polite cap on eBay GetItem calls per pass

let running = false;

type Member = any; // cloud inventory row

function boundsMember(m: Member): BoundsMember {
  return {
    bought_price: m.bought_price ?? null,
    initial_price: m.initial_price ?? null,
    target_price: m.target_price ?? null,
    platform: m.reverb_url ? "reverb" : "ebay",
  };
}

// One eBay listing can cover several inventory items (multi-unit) — those
// members share a price. Group exactly like sold-sync does.
function groupByEbay(items: Member[]): Map<string, Member[]> {
  const groups = new Map<string, Member[]>();
  for (const item of items) {
    const eid = ebayItemIdFromUrl(item.ebay_url);
    const key = eid || `solo:${item.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return groups;
}

// The autopilot is only safe when the cloud PERSISTS its state: the cadence
// anchor (repriced_at) stops a markdown from repeating every pass, and
// initial_price pins the no-cost floor. An out-of-date edge function silently
// drops those fields while answering 200 — so before touching any live price,
// write a real value and check the echo. Dropped echo = stand down loudly.
async function cloudPersistsAutopilotState(listed: Member[]): Promise<boolean> {
  const probe = listed.find((i) => i.target_price != null);
  if (!probe) return false; // nothing priceable — nothing to do anyway
  const want = probe.initial_price ?? probe.target_price;
  try {
    const data = await callCloud({ action: "update", id: probe.id, initial_price: want });
    const echoed = data?.item;
    if (echoed && Number(echoed.initial_price) === Number(want)) {
      probe.initial_price = want; // the probe doubles as this item's anchor
      return true;
    }
  } catch {
    // cloud unreachable — treat like "not ready" and try again next pass
  }
  console.error(
    "Repricer: the cloud hasn't been updated for the autopilot (inventory edge fn v8 + columns migration, " +
      "see supabase/functions/README.md) — standing down, no prices touched. Tell Claude."
  );
  return false;
}

export async function repriceOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const items = await fetchCloudInventory().catch(() => [] as Member[]);
    const listed = items.filter(
      (i) => i.status === "listed" && (i.reverb_url || i.ebay_url)
    );
    if (listed.length === 0) return;
    if (!(await cloudPersistsAutopilotState(listed))) return;

    const reverbStats = await fetchReverbEngagement();
    const ebayOk = ebayConnection().connected;
    let ebayLookups = 0;
    let changed = 0;
    let held = 0;
    let failed = 0;

    for (const [key, members] of groupByEbay(listed)) {
      try {
        const eid = key.startsWith("solo:") ? "" : key;

        // Engagement: Reverb stats per member, eBay watchers on the shared
        // listing. Null = unknown; zero is a real "nobody's looking".
        let views: number | null = null;
        let watches: number | null = null;
        let ebayWatches: number | null = null;
        for (const m of members) {
          const rid = reverbIdFromUrl(m.reverb_url);
          const s = rid ? reverbStats.get(rid) : undefined;
          if (s?.views != null) views = (views ?? 0) + s.views;
          if (s?.watches != null) watches = (watches ?? 0) + s.watches;
        }
        if (eid && ebayOk && ebayLookups < EBAY_WATCH_CAP) {
          ebayLookups++;
          ebayWatches = await getEbayWatchCount(eid);
          if (ebayWatches != null) watches = (watches ?? 0) + ebayWatches;
        }

        // Keep the phone's listing panel live: each row shows ITS OWN Reverb
        // numbers (plus the shared eBay watchers only for a solo item, so a
        // 4-unit group doesn't show every unit wearing the group total).
        for (const m of members) {
          const rid = reverbIdFromUrl(m.reverb_url);
          const s = rid ? reverbStats.get(rid) : undefined;
          const own = {
            views: s?.views ?? null,
            watches:
              s?.watches != null || ebayWatches != null
                ? (s?.watches ?? 0) + (members.length === 1 ? ebayWatches ?? 0 : 0)
                : null,
          };
          await callCloud({ action: "update", id: m.id, ...own }).catch(() => {});
        }

        // The group prices as one; the cheapest member's price is the shared
        // price, but the bounds protect EVERY member (highest floor wins).
        const rep = members.reduce((a: Member, b: Member) =>
          (a.target_price ?? Infinity) <= (b.target_price ?? Infinity) ? a : b
        );
        const bounds: GroupBounds = groupBounds(members.map(boundsMember));

        const decision = planReprice(
          {
            target_price: rep.target_price ?? null,
            auto_reprice: members.every((m: Member) => m.auto_reprice !== false),
            created_at: rep.created_at,
            repriced_at: rep.repriced_at ?? null,
            views,
            watches,
          },
          bounds,
          Date.now()
        );

        // First sight: start the clock and pin the first asking price —
        // markdowns begin a full cadence later.
        if (decision.stage === "anchor") {
          const now = new Date().toISOString();
          for (const m of members) {
            await callCloud({
              action: "update",
              id: m.id,
              repriced_at: now,
              ...(m.initial_price == null && m.target_price != null ? { initial_price: m.target_price } : {}),
            }).catch((err) => console.error("Repricer: anchor write failed:", err));
          }
          held++;
          continue;
        }

        if (decision.newPrice == null) {
          held++;
          if (decision.stage !== "hold" && decision.stage !== "fresh") {
            console.log(`Repricer: "${rep.title}" holds at $${rep.target_price} (${decision.stage}: ${decision.reason})`);
          }
          continue;
        }

        // Apply to every platform. The writeback happens ONLY when everything
        // succeeded — otherwise nothing is recorded, so the next pass computes
        // the SAME price from the same anchor and retries (a re-PUT of the
        // same price is harmless). An already-ended listing counts as done;
        // sold-sync is about to mark it sold.
        const newPrice = decision.newPrice;
        console.log(
          `Repricer: "${rep.title}" $${rep.target_price} -> $${newPrice} (${decision.stage}: ${decision.reason})` +
            (views != null || watches != null ? ` [${views ?? "?"} views, ${watches ?? "?"} watching]` : "")
        );

        let allOk = true;
        const doneMembers: Member[] = [];
        for (const m of members) {
          const rid = reverbIdFromUrl(m.reverb_url);
          if (!rid) {
            doneMembers.push(m);
            continue;
          }
          const r = await updateReverbPrice(rid, newPrice);
          if (r.ok) doneMembers.push(m);
          else if (r.gone) {
            // ended/sold mid-pass — leave its row alone, sold-sync owns it
          } else allOk = false;
        }
        if (eid) {
          if (!ebayOk) {
            allOk = false;
            console.error(`Repricer: eBay not connected — can't reprice "${rep.title}" on eBay; will retry next pass.`);
          } else {
            const hasReverb = members.some((m: Member) => m.reverb_url);
            const e = await reviseEbayPrice(eid, ebayAskPrice(newPrice, hasReverb));
            if (!e.ok && !e.gone) {
              allOk = false;
              console.error(`Repricer: eBay price change failed for "${rep.title}" — retrying next pass. If this repeats, CHECK IT ON EBAY.`);
            }
          }
        }

        if (allOk) {
          changed++;
          const now = new Date().toISOString();
          for (const m of doneMembers) {
            await callCloud({
              action: "update",
              id: m.id,
              target_price: newPrice,
              repriced_at: now,
            }).catch((err) => console.error("Repricer: writeback failed:", err));
          }
        } else {
          failed++;
        }
      } catch (err) {
        // One group must never kill the pass for the rest
        failed++;
        console.error("Repricer: group failed (continuing):", err instanceof Error ? err.message : err);
      }
    }

    // Heartbeat — a silent automation is an untrustworthy one
    console.log(
      `Repricer pass done: ${listed.length} listed items, ${changed} price changes, ${held} holds, ${failed} failures (retried next pass), ${ebayLookups} eBay engagement lookups.`
    );
  } finally {
    running = false;
  }
}

export function startRepricer(): void {
  if (!process.env.PUBLISH_KEY || !process.env.PUBLISH_URL) return;
  cron.schedule(REPRICE_CRON, () => {
    repriceOnce().catch((err) => console.error("Repricer failed:", err));
  });
  setTimeout(() => repriceOnce().catch((err) => console.error("Repricer failed:", err)), STARTUP_DELAY_MS);
  console.log("Repricing autopilot started (daily at 10:15am; margin floors in pricing.ts).");
}

// Owner-tapped price change from the phone: push a specific price to every
// platform the item (and its multi-unit siblings) is listed on. The owner may
// set ANY price — floors bind the autopilot, not the owner. If any platform
// DID change, the new price is recorded even when another platform failed, so
// the phone shows the truth and the autopilot can never "undo" his price.
export async function applyManualPrice(
  inventoryId: string,
  price: number
): Promise<{
  ok: boolean;
  price?: number;
  ebay_price?: number | null;
  siblings?: number;
  error?: string;
}> {
  if (!(price > 0)) return { ok: false, error: "Price must be above 0." };
  const items = await fetchCloudInventory();
  const row = items.find((i: Member) => i.id === inventoryId);
  if (!row) return { ok: false, error: "Item not found in inventory." };

  // Multi-unit siblings share the eBay listing, so they must share the price
  const eid = ebayItemIdFromUrl(row.ebay_url);
  const members = eid
    ? items.filter((i: Member) => ebayItemIdFromUrl(i.ebay_url) === eid && i.status === "listed")
    : [row];
  if (members.length === 0) members.push(row);

  let anyApplied = false;
  const errors: string[] = [];
  for (const m of members) {
    const rid = reverbIdFromUrl(m.reverb_url);
    if (!rid) continue;
    try {
      const r = await updateReverbPrice(rid, price);
      if (r.ok) anyApplied = true;
      else if (!r.gone) errors.push(`Reverb: ${r.error || "failed"}`);
    } catch (err) {
      errors.push(`Reverb: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  let ebayPrice: number | null = null;
  if (eid) {
    const hasReverb = members.some((m: Member) => m.reverb_url);
    ebayPrice = ebayAskPrice(price, hasReverb);
    try {
      const e = await reviseEbayPrice(eid, ebayPrice);
      if (e.ok) anyApplied = true;
      else if (!e.gone) errors.push(`eBay: ${e.error || "failed"}`);
    } catch (err) {
      errors.push(`eBay: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  // Record the owner's price whenever anything changed, even partially —
  // otherwise the cloud would keep the old price and the next autopilot pass
  // would push live listings BACK UP toward it.
  if (anyApplied) {
    const now = new Date().toISOString();
    for (const m of members) {
      await callCloud({ action: "update", id: m.id, target_price: price, repriced_at: now }).catch(
        (err) => console.error("Manual reprice writeback failed:", err)
      );
    }
  }

  if (errors.length > 0) {
    const where = anyApplied ? "Partly done — the rest failed. " : "";
    return { ok: false, error: `${where}${errors.join(" | ")}${anyApplied ? " Tap again to retry the failed platform." : ""}` };
  }
  return { ok: true, price, ebay_price: ebayPrice, siblings: members.length - 1 };
}

export { floorFor };
