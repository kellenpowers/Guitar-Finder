import {
  REVERB_FEE_PCT,
  REVERB_FEE_FIXED,
  EBAY_FEE_PCT,
  EBAY_FEE_FIXED,
  priceToNet,
} from "./fees.js";

// The repricing autopilot's brain. Pure functions only — the repricer service
// applies these decisions to the live platforms.
//
// Owner's standing authorization (Oct 26, 2026): as long as the agreed margin
// holds, price changes on his own listings are handled automatically. If
// nobody is viewing or watching a listing, act sooner. Items that sit unsold
// long enough may go BELOW the margin floor as a last resort ("if we need to
// move the merch") — but never below fee-adjusted breakeven on what he paid;
// selling at an actual loss is always his call, never the autopilot's.

// ===== Margin doctrine (owner's rule, mirrors client/src/lib/economics.ts) =====
export const MARGIN_BREAKPOINT = 100; // "cheap item" threshold in dollars
export const BASE_MARGIN = 1.0; // 100% ROI at or above the breakpoint
export const SMALL_ITEM_MARGIN = 2.0; // 200% ROI below it

// ===== Repricing policy tunables =====
export const HOLD_DAYS = 7; // a fresh listing keeps its price for a week
export const STEP_PCT = 0.05; // each markdown is 5%
export const STEP_EVERY_DAYS = 7; // normal markdown cadence
export const DEAD_STEP_EVERY_DAYS = 4; // cadence when NOBODY is viewing or watching (known zeros, not missing data)
export const WATCHED_STEP_EVERY_DAYS = 14; // cadence when people are watching (price is close)
export const LAST_RESORT_DAYS = 45; // listed this long + at the floor -> may go below it
export const NO_COST_FLOOR_FRACTION = 0.5; // bundle items without their own cost: floor = half the first asking price
export const MIN_AUTO_PRICE = 20; // the autopilot never prices anything below this

export type Platform = "reverb" | "ebay";

// Profit the doctrine demands on an item bought at this price
export function requiredProfit(bought: number): number {
  return bought * (bought < MARGIN_BREAKPOINT ? SMALL_ITEM_MARGIN : BASE_MARGIN);
}

const fees = (platform: Platform) =>
  platform === "ebay"
    ? { pct: EBAY_FEE_PCT, fixed: EBAY_FEE_FIXED }
    : { pct: REVERB_FEE_PCT, fixed: REVERB_FEE_FIXED };

// Lowest asking price that still clears the margin doctrine after the given
// platform's fees. Reverb-listed items use Reverb fees (their eBay ask is
// fee-matched above the Reverb price at apply time, so the Reverb floor
// protects both); eBay-ONLY items must clear eBay's bigger cut directly.
export function marginFloorPrice(boughtPrice: number, platform: Platform = "reverb"): number {
  const f = fees(platform);
  return priceToNet(boughtPrice + requiredProfit(boughtPrice), f.pct, f.fixed);
}

// Fee-adjusted breakeven: the price that just recovers the purchase money.
export function breakevenPrice(boughtPrice: number, platform: Platform = "reverb"): number {
  const f = fees(platform);
  return priceToNet(boughtPrice, f.pct, f.fixed);
}

const round = (p: number) => Math.round(p);

// The floor one member needs: the margin-doctrine floor when its cost is
// known; a conservative fraction of the first asking price for bundle items
// without their own cost on file (bought_price 0 counts as "no cost" — a
// freebie still shouldn't be given away).
export interface BoundsMember {
  bought_price: number | null;
  initial_price: number | null;
  target_price: number | null;
  platform: Platform; // "reverb" when the member has a Reverb listing, else "ebay"
}

export function floorFor(m: BoundsMember): number | null {
  if (m.bought_price != null && m.bought_price > 0) {
    return Math.max(MIN_AUTO_PRICE, round(marginFloorPrice(m.bought_price, m.platform)));
  }
  const anchor = m.initial_price ?? m.target_price;
  if (!anchor || anchor <= 0) return null;
  return Math.max(MIN_AUTO_PRICE, round(anchor * NO_COST_FLOOR_FRACTION));
}

// A multi-unit group prices as one, so its bounds must protect EVERY member:
// the floor is the highest member floor, and last-resort pricing (below the
// floor, above breakeven) is only allowed when every member has a real cost —
// salvage is then the highest member breakeven. salvage null = no last resort.
export interface GroupBounds {
  floor: number | null;
  salvage: number | null;
}

export function groupBounds(members: BoundsMember[]): GroupBounds {
  let floor: number | null = null;
  for (const m of members) {
    const f = floorFor(m);
    if (f != null) floor = floor == null ? f : Math.max(floor, f);
  }
  const allCosted = members.length > 0 && members.every((m) => m.bought_price != null && m.bought_price > 0);
  let salvage: number | null = null;
  if (allCosted) {
    for (const m of members) {
      const b = Math.max(MIN_AUTO_PRICE, breakevenPrice(m.bought_price!, m.platform));
      salvage = salvage == null ? b : Math.max(salvage, b);
    }
  }
  return { floor, salvage };
}

export interface RepriceInput {
  target_price: number | null;
  auto_reprice: boolean;
  created_at: string; // when the item entered inventory
  repriced_at: string | null; // last price change / autopilot anchor (null = never seen)
  views: number | null; // platform view count (null = unknown)
  watches: number | null; // watcher count across platforms (null = unknown)
}

export type RepriceStage =
  | "paused" // owner turned autopilot off for this item
  | "no_price" // no target price to work from
  | "anchor" // first sight — start the clock, touch nothing
  | "fresh" // listed under HOLD_DAYS — hold
  | "hold" // waiting out the cadence since the last change
  | "markdown" // stepping the price down
  | "at_floor" // sitting at the margin floor
  | "last_resort" // owner-authorized move below the floor to move the merch
  | "salvage_floor"; // at breakeven — going lower is the owner's call only

export interface RepriceDecision {
  newPrice: number | null; // null = leave the price alone this pass
  floor: number | null; // the floor in effect
  stage: RepriceStage;
  reason: string;
}

const DAY_MS = 86_400_000;

export function planReprice(item: RepriceInput, bounds: GroupBounds, nowMs: number): RepriceDecision {
  const floor = bounds.floor;
  if (!item.auto_reprice) {
    return { newPrice: null, floor, stage: "paused", reason: "autopilot off for this item" };
  }
  const target = item.target_price;
  if (!target || target <= 0) {
    return { newPrice: null, floor, stage: "no_price", reason: "no target price set" };
  }
  if (floor == null) {
    // No cost, no recorded first ask — nothing safe to compute from
    return { newPrice: null, floor, stage: "no_price", reason: "no floor could be computed" };
  }

  // First sight: anchor the clock (the repricer records repriced_at and the
  // first asking price), change nothing. This also keeps items that sat in
  // "prepping" for weeks from being marked down the day they go live.
  if (!item.repriced_at) {
    return { newPrice: null, floor, stage: "anchor", reason: "first look — starting the clock at the current price" };
  }

  const ageDays = (nowMs - Date.parse(item.created_at)) / DAY_MS;
  const sinceChangeDays = (nowMs - Date.parse(item.repriced_at)) / DAY_MS;

  if (ageDays < HOLD_DAYS) {
    return { newPrice: null, floor, stage: "fresh", reason: `listed ${Math.floor(ageDays)}d — new listings hold for ${HOLD_DAYS}d` };
  }

  // Engagement sets the cadence: watchers mean the price is close (move slowly
  // — they're offer targets); a KNOWN-zero audience means the price is wrong
  // (move sooner). Missing data is unknown, not zero — normal cadence.
  const watched = (item.watches ?? 0) > 0;
  const dead = !watched && item.views === 0 && (item.watches ?? 0) === 0;
  const cadence = watched ? WATCHED_STEP_EVERY_DAYS : dead ? DEAD_STEP_EVERY_DAYS : STEP_EVERY_DAYS;

  if (sinceChangeDays < cadence) {
    const why = watched ? "has watchers — moving slowly" : dead ? "no eyes on it — next step soon" : "waiting out the cadence";
    return { newPrice: null, floor, stage: "hold", reason: `${Math.floor(sinceChangeDays)}d since last change (${why}, steps every ${cadence}d)` };
  }

  const candidate = Math.min(round(target * (1 - STEP_PCT)), target - 1);

  // Still above the floor: ordinary markdown, clamped to the floor
  if (target > floor) {
    const newPrice = Math.max(floor, Math.max(MIN_AUTO_PRICE, candidate));
    if (newPrice >= target) {
      return { newPrice: null, floor, stage: "at_floor", reason: "already at the lowest price the margin allows" };
    }
    return {
      newPrice,
      floor,
      stage: "markdown",
      reason: newPrice === floor ? `marked down to the margin floor $${floor}` : `${Math.round(STEP_PCT * 100)}% markdown`,
    };
  }

  // At or below the floor. Without a full cost basis (bundle items) there is
  // no safe "below the floor" — stop here.
  if (bounds.salvage == null) {
    return {
      newPrice: null,
      floor,
      stage: "at_floor",
      reason: "at the estimated floor — add what you paid (Paid $) to unlock exact floors",
    };
  }

  if (ageDays < LAST_RESORT_DAYS || watched) {
    return {
      newPrice: null,
      floor,
      stage: "at_floor",
      reason: watched
        ? "at the floor with watchers — offers, not markdowns, are the next move"
        : `holding at the margin floor (last resort unlocks at ${LAST_RESORT_DAYS}d listed)`,
    };
  }

  // Last resort (owner's Oct 26 2026 decision): move the merch below the
  // margin floor — but never below fee-adjusted breakeven. A real loss is the
  // owner's call, not the autopilot's.
  const salvage = bounds.salvage;
  if (target <= salvage) {
    return {
      newPrice: null,
      floor,
      stage: "salvage_floor",
      reason: "at breakeven — selling at a loss is the owner's call, not the autopilot's",
    };
  }
  const newPrice = Math.max(salvage, Math.max(MIN_AUTO_PRICE, candidate));
  if (newPrice >= target) {
    return { newPrice: null, floor, stage: "salvage_floor", reason: "at breakeven — holding" };
  }
  return {
    newPrice,
    floor,
    stage: "last_resort",
    reason: `last resort: ${Math.floor(ageDays)}d listed with no takers — moving below the margin floor (still above breakeven $${round(salvage)})`,
  };
}
