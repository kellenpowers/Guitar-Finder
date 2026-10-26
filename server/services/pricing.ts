import { REVERB_FEE_PCT, REVERB_FEE_FIXED, priceToNet } from "./fees.js";

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
export const DEAD_STEP_EVERY_DAYS = 4; // cadence when NOBODY is viewing or watching
export const WATCHED_STEP_EVERY_DAYS = 14; // cadence when people are watching (price is close)
export const LAST_RESORT_DAYS = 45; // listed this long + at the floor -> may go below it
export const NO_COST_FLOOR_FRACTION = 0.5; // bundle items without their own cost: floor = half the first asking price
export const MIN_AUTO_PRICE = 20; // the autopilot never prices anything below this

// Profit the doctrine demands on an item bought at this price
export function requiredProfit(bought: number): number {
  return bought * (bought < MARGIN_BREAKPOINT ? SMALL_ITEM_MARGIN : BASE_MARGIN);
}

// Lowest Reverb asking price that still clears the margin doctrine after fees.
// (The eBay price is derived from the Reverb price at apply time, fee-matched,
// so one floor governs both platforms.)
export function marginFloorPrice(boughtPrice: number): number {
  return priceToNet(boughtPrice + requiredProfit(boughtPrice), REVERB_FEE_PCT, REVERB_FEE_FIXED);
}

// Fee-adjusted breakeven: the price that just recovers the purchase money.
export function breakevenPrice(boughtPrice: number): number {
  return priceToNet(boughtPrice, REVERB_FEE_PCT, REVERB_FEE_FIXED);
}

export interface RepriceInput {
  bought_price: number | null;
  target_price: number | null;
  initial_price: number | null; // first asking price (anchors the no-cost floor)
  auto_reprice: boolean;
  created_at: string; // when the item entered inventory (≈ listing age)
  repriced_at: string | null; // last price change (null = never changed)
  views: number | null; // platform view count (null = unknown)
  watches: number | null; // watcher count across platforms (null = unknown)
}

export type RepriceStage =
  | "paused" // owner turned autopilot off for this item
  | "no_price" // no target price to work from
  | "fresh" // listed under HOLD_DAYS — hold
  | "hold" // waiting out the cadence since the last change
  | "markdown" // stepping the price down
  | "at_floor" // sitting at the margin floor
  | "last_resort" // owner-authorized move below the floor to move the merch
  | "salvage_floor"; // at breakeven — going lower is the owner's call only

export interface RepriceDecision {
  newPrice: number | null; // null = leave the price alone this pass
  floor: number | null; // the margin floor in effect (estimated for no-cost items)
  stage: RepriceStage;
  reason: string;
}

const DAY_MS = 86_400_000;
const round = (p: number) => Math.round(p);

export function planReprice(item: RepriceInput, nowMs: number): RepriceDecision {
  if (!item.auto_reprice) {
    return { newPrice: null, floor: floorFor(item), stage: "paused", reason: "autopilot off for this item" };
  }
  const target = item.target_price;
  if (!target || target <= 0) {
    return { newPrice: null, floor: null, stage: "no_price", reason: "no target price set" };
  }

  const floor = floorFor(item)!;
  const ageDays = (nowMs - Date.parse(item.created_at)) / DAY_MS;
  const sinceChangeDays = item.repriced_at ? (nowMs - Date.parse(item.repriced_at)) / DAY_MS : ageDays;

  if (ageDays < HOLD_DAYS) {
    return { newPrice: null, floor, stage: "fresh", reason: `listed ${Math.floor(ageDays)}d — new listings hold for ${HOLD_DAYS}d` };
  }

  // Engagement sets the cadence: watchers mean the price is close (move slowly
  // — they're offer targets); zero eyes mean the price is wrong (move sooner).
  const watched = (item.watches ?? 0) > 0;
  const dead = !watched && (item.views ?? 0) === 0 && (item.views !== null || item.watches !== null);
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

  // At or below the margin floor. Bundle items without their own cost stop
  // here — without a cost basis there is no safe "below the floor".
  if (item.bought_price == null) {
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
  const salvage = Math.max(MIN_AUTO_PRICE, breakevenPrice(item.bought_price));
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

// The floor in effect for an item: the margin doctrine floor when we know the
// cost; a conservative fraction of the first asking price for bundle items
// that don't have their own cost on file.
export function floorFor(item: {
  bought_price: number | null;
  initial_price: number | null;
  target_price: number | null;
}): number | null {
  if (item.bought_price != null && item.bought_price > 0) {
    return Math.max(MIN_AUTO_PRICE, round(marginFloorPrice(item.bought_price)));
  }
  const anchor = item.initial_price ?? item.target_price;
  if (!anchor || anchor <= 0) return null;
  return Math.max(MIN_AUTO_PRICE, round(anchor * NO_COST_FLOOR_FRACTION));
}
