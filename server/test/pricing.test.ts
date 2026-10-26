import { describe, it, expect } from "vitest";
import {
  marginFloorPrice,
  breakevenPrice,
  requiredProfit,
  floorFor,
  groupBounds,
  planReprice,
  HOLD_DAYS,
  LAST_RESORT_DAYS,
  MIN_AUTO_PRICE,
  type RepriceInput,
  type GroupBounds,
} from "../services/pricing.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-26T15:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

// A $150 buy listed on Reverb at $400: floor $329, breakeven $164.99
const BOUNDS_150: GroupBounds = groupBounds([
  { bought_price: 150, initial_price: 400, target_price: 400, platform: "reverb" },
]);

// A listed item 30 days old, last changed 10 days ago, modest engagement
function base(over: Partial<RepriceInput> = {}): RepriceInput {
  return {
    target_price: 400,
    auto_reprice: true,
    created_at: daysAgo(30),
    repriced_at: daysAgo(10),
    views: 5,
    watches: 0,
    ...over,
  };
}

describe("margin doctrine floors", () => {
  it("demands 100% ROI, 200% under $100", () => {
    expect(requiredProfit(150)).toBe(150);
    expect(requiredProfit(50)).toBe(100);
  });

  it("floor price nets cost + required profit after the platform's fees", () => {
    // $150 buy on Reverb -> must net $300 -> ceil(300.49 / (1 - 8.41%)) - .01
    expect(marginFloorPrice(150, "reverb")).toBeCloseTo(328.99, 2);
    // $50 buy -> must net $150 (200%)
    expect(marginFloorPrice(50, "reverb")).toBeCloseTo(164.99, 2);
    // eBay-only items must clear eBay's bigger cut (~14.18% + $0.40)
    expect(marginFloorPrice(150, "ebay")).toBeCloseTo(350.99, 2);
  });

  it("breakeven just recovers the purchase money after fees", () => {
    expect(breakevenPrice(150, "reverb")).toBeCloseTo(164.99, 2);
    expect(breakevenPrice(150, "ebay")).toBeCloseTo(175.99, 2);
  });

  it("floorFor: margin floor with a cost, half the first ask without one, null with nothing", () => {
    expect(floorFor({ bought_price: 150, initial_price: null, target_price: 400, platform: "reverb" })).toBe(329);
    expect(floorFor({ bought_price: null, initial_price: 200, target_price: 180, platform: "reverb" })).toBe(100);
    expect(floorFor({ bought_price: null, initial_price: null, target_price: 180, platform: "reverb" })).toBe(90);
    expect(floorFor({ bought_price: null, initial_price: null, target_price: null, platform: "reverb" })).toBeNull();
    // $0 "cost" (a freebie) is still no-cost — estimated floor, not breakeven $1
    expect(floorFor({ bought_price: 0, initial_price: 200, target_price: 200, platform: "reverb" })).toBe(100);
    // the estimated floor never goes below the autopilot minimum
    expect(floorFor({ bought_price: null, initial_price: 30, target_price: 30, platform: "reverb" })).toBe(MIN_AUTO_PRICE);
  });

  it("group bounds protect the COSTLIEST member, not the cheapest", () => {
    // A ($50 buy) and B ($150 buy) share one eBay listing and one price
    const b = groupBounds([
      { bought_price: 50, initial_price: 400, target_price: 400, platform: "reverb" },
      { bought_price: 150, initial_price: 400, target_price: 400, platform: "reverb" },
    ]);
    expect(b.floor).toBe(329); // B's floor, not A's $165
    expect(b.salvage).toBeCloseTo(164.99, 2); // B's breakeven, not A's $55.99
  });

  it("one no-cost member in a group forbids last resort for the whole group", () => {
    const b = groupBounds([
      { bought_price: 150, initial_price: 400, target_price: 400, platform: "reverb" },
      { bought_price: null, initial_price: 400, target_price: 400, platform: "reverb" },
    ]);
    expect(b.salvage).toBeNull();
    expect(b.floor).toBe(329); // the costed member's floor still binds
  });
});

describe("planReprice", () => {
  it("anchors on first sight instead of marking down (prepping time doesn't count)", () => {
    // In inventory 22 days (photographing a bundle), just listed, never seen
    const d = planReprice(base({ created_at: daysAgo(22), repriced_at: null }), BOUNDS_150, NOW);
    expect(d.stage).toBe("anchor");
    expect(d.newPrice).toBeNull();
  });

  it("holds fresh listings", () => {
    const d = planReprice(base({ created_at: daysAgo(HOLD_DAYS - 1), repriced_at: daysAgo(1) }), BOUNDS_150, NOW);
    expect(d.stage).toBe("fresh");
    expect(d.newPrice).toBeNull();
  });

  it("respects the per-item autopilot switch", () => {
    expect(planReprice(base({ auto_reprice: false }), BOUNDS_150, NOW).stage).toBe("paused");
  });

  it("does nothing without a target price", () => {
    expect(planReprice(base({ target_price: null }), BOUNDS_150, NOW).stage).toBe("no_price");
  });

  it("marks down 5% on the normal weekly cadence", () => {
    const d = planReprice(base(), BOUNDS_150, NOW); // changed 10d ago, some views
    expect(d.stage).toBe("markdown");
    expect(d.newPrice).toBe(380);
  });

  it("waits out the cadence when the last change is recent", () => {
    expect(planReprice(base({ repriced_at: daysAgo(5) }), BOUNDS_150, NOW).stage).toBe("hold");
  });

  it("moves sooner when NOBODY is viewing or watching", () => {
    // 5 days since the last change: too soon normally, not for a dead listing
    const dead = planReprice(base({ repriced_at: daysAgo(5), views: 0, watches: 0 }), BOUNDS_150, NOW);
    expect(dead.stage).toBe("markdown");
    const seen = planReprice(base({ repriced_at: daysAgo(5), views: 12, watches: 0 }), BOUNDS_150, NOW);
    expect(seen.stage).toBe("hold");
  });

  it("treats missing engagement data as unknown, never as dead", () => {
    // both unknown (engagement fetch failed)
    expect(planReprice(base({ repriced_at: daysAgo(5), views: null, watches: null }), BOUNDS_150, NOW).stage).toBe("hold");
    // eBay-only item: views are never collected, 0 watchers is not "dead"
    expect(planReprice(base({ repriced_at: daysAgo(5), views: null, watches: 0 }), BOUNDS_150, NOW).stage).toBe("hold");
  });

  it("moves slower when people are watching — the price is close", () => {
    const d = planReprice(base({ watches: 3 }), BOUNDS_150, NOW); // 10d since change
    expect(d.stage).toBe("hold");
    const later = planReprice(base({ watches: 3, repriced_at: daysAgo(15) }), BOUNDS_150, NOW);
    expect(later.stage).toBe("markdown");
  });

  it("clamps the markdown at the margin floor", () => {
    const d = planReprice(base({ target_price: 340 }), BOUNDS_150, NOW); // floor is 329
    expect(d.newPrice).toBe(329);
    expect(d.stage).toBe("markdown");
  });

  it("holds at the floor before the last-resort window", () => {
    const d = planReprice(base({ target_price: 329 }), BOUNDS_150, NOW); // 30d old
    expect(d.stage).toBe("at_floor");
    expect(d.newPrice).toBeNull();
  });

  it("goes below the floor only as a last resort, and never below breakeven", () => {
    const stale = base({ target_price: 329, created_at: daysAgo(LAST_RESORT_DAYS + 15) });
    const d = planReprice(stale, BOUNDS_150, NOW);
    expect(d.stage).toBe("last_resort");
    expect(d.newPrice).toBe(313); // 5% below the floor
    // approaching breakeven ($164.99 on a $150 buy): clamped, then stopped
    const nearSalvage = planReprice({ ...stale, target_price: 170 }, BOUNDS_150, NOW);
    expect(nearSalvage.newPrice).toBeCloseTo(164.99, 2);
    const atSalvage = planReprice({ ...stale, target_price: 164 }, BOUNDS_150, NOW);
    expect(atSalvage.stage).toBe("salvage_floor");
    expect(atSalvage.newPrice).toBeNull();
  });

  it("watchers block the last resort — offers are the next move, not a fire sale", () => {
    const d = planReprice(
      base({
        target_price: 329,
        created_at: daysAgo(LAST_RESORT_DAYS + 15),
        repriced_at: daysAgo(20), // past even the slow watched cadence
        watches: 2,
      }),
      BOUNDS_150,
      NOW
    );
    expect(d.stage).toBe("at_floor");
  });

  it("no salvage (bundle items without a cost) stops at the estimated floor", () => {
    const bounds = groupBounds([
      { bought_price: null, initial_price: 200, target_price: 100, platform: "reverb" },
    ]); // estimated floor = half of $200
    const d = planReprice(base({ target_price: 100, created_at: daysAgo(LAST_RESORT_DAYS + 15) }), bounds, NOW);
    expect(d.stage).toBe("at_floor");
    expect(d.newPrice).toBeNull();
    // ...but marks down normally above it
    const above = planReprice(base({ target_price: 180 }), bounds, NOW);
    expect(above.stage).toBe("markdown");
    expect(above.newPrice).toBe(171);
  });

  it("never prices anything below the autopilot minimum", () => {
    const bounds = groupBounds([
      { bought_price: null, initial_price: 24, target_price: 24, platform: "reverb" },
    ]);
    const d = planReprice(base({ target_price: 24 }), bounds, NOW);
    expect(d.newPrice === null || d.newPrice >= MIN_AUTO_PRICE).toBe(true);
  });
});
