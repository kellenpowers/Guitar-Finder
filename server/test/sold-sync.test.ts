import { describe, it, expect } from "vitest";
import { planGroupSync, reverbOrderListingId, type GroupMember } from "../services/sold-sync.js";

describe("reverbOrderListingId (order payload shapes)", () => {
  it("reads the listing id from any known field", () => {
    expect(reverbOrderListingId({ product_id: 102834010 })).toBe("102834010");
    expect(reverbOrderListingId({ listing_id: "102834010" })).toBe("102834010");
    expect(
      reverbOrderListingId({ _links: { listing: { href: "https://api.reverb.com/api/listings/102834010" } } })
    ).toBe("102834010");
    expect(reverbOrderListingId({})).toBe("");
  });
});

// Four identical speakers: ONE eBay listing with 4 units, FOUR Reverb listings
const bose = (): GroupMember[] => [
  { id: "a", status: "listed", rid: "r1" },
  { id: "b", status: "listed", rid: "r2" },
  { id: "c", status: "listed", rid: "r3" },
  { id: "d", status: "listed", rid: "r4" },
];

describe("planGroupSync (multi-unit cross-platform sync)", () => {
  it("one sells on Reverb: mark it sold, drop the eBay quantity to 3", () => {
    const plan = planGroupSync(bose(), 0, new Set(["r2"]));
    expect(plan.markSoldViaReverb.map((m) => m.id)).toEqual(["b"]);
    expect(plan.markSoldViaEbay).toEqual([]);
    expect(plan.ebayQuantityTarget).toBe(3);
  });

  it("one unit sells on eBay: mark one item sold and end ITS Reverb listing, leave eBay's own count alone", () => {
    const plan = planGroupSync(bose(), 1, new Set());
    expect(plan.markSoldViaEbay.length).toBe(1);
    expect(plan.markSoldViaEbay[0].rid).toBe("r1");
    expect(plan.markSoldViaReverb).toEqual([]);
    expect(plan.ebayQuantityTarget).toBeNull();
  });

  it("is idempotent: a sale already reflected by a sold member is not processed again", () => {
    const members = bose();
    members[0].status = "sold"; // the unit from the eBay sale last pass
    const plan = planGroupSync(members, 1, new Set());
    expect(plan.markSoldViaEbay).toEqual([]);
    expect(plan.markSoldViaReverb).toEqual([]);
  });

  it("handles a Reverb sale and an eBay unit sale in the same pass", () => {
    const plan = planGroupSync(bose(), 1, new Set(["r2"]));
    expect(plan.markSoldViaReverb.map((m) => m.id)).toEqual(["b"]);
    expect(plan.markSoldViaEbay.length).toBe(1);
    expect(plan.markSoldViaEbay[0].id).toBe("a"); // not the Reverb-sold one
    expect(plan.ebayQuantityTarget).toBe(2);
  });

  it("the last unit selling on Reverb ends the eBay listing (target 0)", () => {
    const members: GroupMember[] = [
      { id: "a", status: "sold", rid: "r1" },
      { id: "b", status: "sold", rid: "r2" },
      { id: "c", status: "sold", rid: "r3" },
      { id: "d", status: "listed", rid: "r4" },
    ];
    const plan = planGroupSync(members, 0, new Set(["r4"]));
    expect(plan.markSoldViaReverb.map((m) => m.id)).toEqual(["d"]);
    expect(plan.ebayQuantityTarget).toBe(0);
  });

  it("a single item behaves like the old logic (group of one)", () => {
    const solo: GroupMember[] = [{ id: "x", status: "listed", rid: "r9" }];
    // sold on Reverb -> end the eBay listing
    const viaReverb = planGroupSync(solo, 0, new Set(["r9"]));
    expect(viaReverb.markSoldViaReverb.length).toBe(1);
    expect(viaReverb.ebayQuantityTarget).toBe(0);
    // sold on eBay -> end the Reverb listing
    const viaEbay = planGroupSync([{ id: "x", status: "listed", rid: "r9" }], 1, new Set());
    expect(viaEbay.markSoldViaEbay.length).toBe(1);
    expect(viaEbay.ebayQuantityTarget).toBeNull();
  });

  it("members that sold on Reverb don't count against eBay's sale tally", () => {
    const members = bose();
    members[0].status = "sold"; // sold via Reverb previously
    const plan = planGroupSync(members, 1, new Set(["r1"]));
    // the one eBay unit sold is NOT already accounted for by member a
    expect(plan.markSoldViaEbay.length).toBe(1);
  });
});
