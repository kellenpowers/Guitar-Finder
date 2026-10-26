import cron from "node-cron";
import { callCloud, fetchCloudInventory } from "./commands.js";
import { planReprice, floorFor, type RepriceInput } from "./pricing.js";
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
const STARTUP_DELAY_MS = 3 * 60_000; // one pass shortly after boot (idempotent — cadence gates re-runs)
const EBAY_WATCH_CAP = 40; // polite cap on eBay GetItem calls per pass

let running = false;

type Member = any; // cloud inventory row

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

export async function repriceOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const items = await fetchCloudInventory().catch(() => [] as Member[]);
    const listed = items.filter(
      (i) => i.status === "listed" && (i.reverb_url || i.ebay_url)
    );
    if (listed.length === 0) return;

    const reverbStats = await fetchReverbEngagement();
    let ebayLookups = 0;
    let changed = 0;
    let held = 0;

    for (const [key, members] of groupByEbay(listed)) {
      const eid = key.startsWith("solo:") ? "" : key;

      // Engagement for the group: Reverb stats per member, eBay watchers on
      // the shared listing. Null = unknown; zero is a real "nobody's looking".
      let views: number | null = null;
      let watches: number | null = null;
      for (const m of members) {
        const rid = reverbIdFromUrl(m.reverb_url);
        const s = rid ? reverbStats.get(rid) : undefined;
        if (s?.views != null) views = (views ?? 0) + s.views;
        if (s?.watches != null) watches = (watches ?? 0) + s.watches;
      }
      if (eid && ebayLookups < EBAY_WATCH_CAP) {
        ebayLookups++;
        const w = await getEbayWatchCount(eid);
        if (w != null) watches = (watches ?? 0) + w;
      }

      // The group prices as one; the cheapest member's numbers are the
      // conservative representative.
      const rep = members.reduce((a, b) =>
        (a.target_price ?? Infinity) <= (b.target_price ?? Infinity) ? a : b
      );

      // First time the autopilot sees a listing, record its starting price —
      // it anchors the estimated floor for bundle items without a cost basis.
      if (rep.initial_price == null && rep.target_price != null) {
        for (const m of members) {
          if (m.initial_price == null && m.target_price != null) {
            m.initial_price = m.target_price;
            await callCloud({ action: "update", id: m.id, initial_price: m.target_price }).catch(() => {});
          }
        }
      }

      const input: RepriceInput = {
        bought_price: rep.bought_price ?? null,
        target_price: rep.target_price ?? null,
        initial_price: rep.initial_price ?? null,
        auto_reprice: rep.auto_reprice !== false, // missing column = default on
        created_at: rep.created_at,
        repriced_at: rep.repriced_at ?? null,
        views,
        watches,
      };
      const decision = planReprice(input, Date.now());

      // Keep the phone's listing panel live: engagement and floor, every pass
      for (const m of members) {
        const rid = reverbIdFromUrl(m.reverb_url);
        const s = rid ? reverbStats.get(rid) : undefined;
        await callCloud({
          action: "update",
          id: m.id,
          views: s?.views ?? views,
          watches,
        }).catch(() => {});
      }

      if (decision.newPrice == null) {
        held++;
        if (decision.stage !== "hold" && decision.stage !== "fresh") {
          console.log(`Repricer: "${rep.title}" holds at $${rep.target_price} (${decision.stage}: ${decision.reason})`);
        }
        continue;
      }

      // Apply: every member's Reverb listing, then the shared eBay listing at
      // the fee-matched price. A platform failure is logged loudly and the
      // writeback still happens for the platforms that DID change, so the next
      // pass retries from honest numbers.
      const newPrice = decision.newPrice;
      console.log(
        `Repricer: "${rep.title}" $${rep.target_price} -> $${newPrice} (${decision.stage}: ${decision.reason})` +
          (views != null || watches != null ? ` [${views ?? "?"} views, ${watches ?? "?"} watching]` : "")
      );

      let anyApplied = false;
      for (const m of members) {
        const rid = reverbIdFromUrl(m.reverb_url);
        if (!rid) continue;
        const r = await updateReverbPrice(rid, newPrice);
        if (r.ok) anyApplied = true;
      }
      if (eid) {
        const hasReverb = members.some((m: Member) => m.reverb_url);
        const e = await reviseEbayPrice(eid, ebayAskPrice(newPrice, hasReverb));
        if (e.ok) anyApplied = true;
        else console.error(`Repricer: eBay price change failed for "${rep.title}" — CHECK IT MANUALLY if this repeats.`);
      }

      if (anyApplied) {
        changed++;
        const now = new Date().toISOString();
        for (const m of members) {
          await callCloud({
            action: "update",
            id: m.id,
            target_price: newPrice,
            repriced_at: now,
          }).catch((err) => console.error("Repricer: writeback failed:", err));
        }
      }
    }

    // Heartbeat — a silent automation is an untrustworthy one
    console.log(
      `Repricer pass done: ${listed.length} listed items, ${changed} price changes, ${held} holds, ${ebayLookups} eBay engagement lookups.`
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
// set ANY price — floors bind the autopilot, not the owner.
export async function applyManualPrice(
  inventoryId: string,
  price: number
): Promise<{
  ok: boolean;
  price?: number;
  ebay_price?: number | null;
  reverb_ok?: boolean | null;
  ebay_ok?: boolean | null;
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

  let reverbOk: boolean | null = null;
  for (const m of members) {
    const rid = reverbIdFromUrl(m.reverb_url);
    if (!rid) continue;
    const r = await updateReverbPrice(rid, price);
    reverbOk = reverbOk === false ? false : r.ok; // any failure wins
    if (!r.ok) return { ok: false, error: r.error || "Reverb price change failed." };
  }

  let ebayOk: boolean | null = null;
  let ebayPrice: number | null = null;
  if (eid) {
    const hasReverb = members.some((m: Member) => m.reverb_url);
    ebayPrice = ebayAskPrice(price, hasReverb);
    const e = await reviseEbayPrice(eid, ebayPrice);
    ebayOk = e.ok;
    if (!e.ok) return { ok: false, error: e.error || "eBay price change failed." };
  }

  const now = new Date().toISOString();
  for (const m of members) {
    await callCloud({ action: "update", id: m.id, target_price: price, repriced_at: now }).catch(
      (err) => console.error("Manual reprice writeback failed:", err)
    );
  }
  return { ok: true, price, ebay_price: ebayPrice, reverb_ok: reverbOk, ebay_ok: ebayOk, siblings: members.length - 1 };
}

export { floorFor };
