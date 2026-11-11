import { describe, it, expect } from "vitest";
import { planTakedown } from "../services/takedown.js";

const EB = (id: string) => `https://www.ebay.com/itm/${id}`;
const RV = (id: string) => `https://reverb.com/item/${id}-thing`;

describe("planTakedown (owner sold it himself — end the live listings)", () => {
  it("solo item on both platforms: end Reverb, end eBay (no units left)", () => {
    const items = [{ id: "a", status: "listed", reverb_url: RV("111"), ebay_url: EB("900") }];
    const plan = planTakedown(items, "a")!;
    expect(plan.reverbId).toBe("111");
    expect(plan.ebay).toEqual({ itemId: "900", remaining: 0 });
  });

  it("one unit of a 4-unit eBay group: quantity drops to the listed siblings", () => {
    const items = [
      { id: "a", status: "listed", reverb_url: RV("1"), ebay_url: EB("900") },
      { id: "b", status: "listed", reverb_url: RV("2"), ebay_url: EB("900") },
      { id: "c", status: "listed", reverb_url: RV("3"), ebay_url: EB("900") },
      { id: "d", status: "listed", reverb_url: RV("4"), ebay_url: EB("900") },
    ];
    const plan = planTakedown(items, "b")!;
    expect(plan.reverbId).toBe("2");
    expect(plan.ebay).toEqual({ itemId: "900", remaining: 3 });
  });

  it("siblings already sold don't count as remaining units", () => {
    const items = [
      { id: "a", status: "sold", reverb_url: RV("1"), ebay_url: EB("900") },
      { id: "b", status: "listed", reverb_url: RV("2"), ebay_url: EB("900") },
      { id: "c", status: "listed", reverb_url: RV("3"), ebay_url: EB("900") },
    ];
    expect(planTakedown(items, "b")!.ebay).toEqual({ itemId: "900", remaining: 1 });
  });

  it("single-platform and no-platform items plan only what exists", () => {
    const items = [
      { id: "r", status: "listed", reverb_url: RV("5"), ebay_url: null },
      { id: "e", status: "listed", reverb_url: null, ebay_url: EB("901") },
      { id: "n", status: "prepping", reverb_url: null, ebay_url: null },
    ];
    expect(planTakedown(items, "r")).toEqual({ reverbId: "5", ebay: null });
    expect(planTakedown(items, "e")).toEqual({ reverbId: "", ebay: { itemId: "901", remaining: 0 } });
    expect(planTakedown(items, "n")).toEqual({ reverbId: "", ebay: null });
  });

  it("unknown item -> null", () => {
    expect(planTakedown([], "nope")).toBeNull();
  });
});
