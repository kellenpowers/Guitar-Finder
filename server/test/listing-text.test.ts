import { describe, it, expect } from "vitest";
import { removePriceTalk } from "../services/listing-text.js";

describe("removePriceTalk (description/price consistency)", () => {
  it("removes the generated 'Asking $X shipped.' line", () => {
    const draft = [
      "Shure SM7B microphone",
      "",
      "Up for sale is my Shure SM7B. It does what it should.",
      "Asking $450 shipped.",
      "Questions welcome.",
    ].join("\n");
    const out = removePriceTalk(draft);
    expect(out).not.toMatch(/450/);
    expect(out).toContain("Up for sale is my Shure SM7B.");
    expect(out).toContain("Questions welcome.");
  });

  it("removes asking-price sentences from imported Reverb paragraphs", () => {
    const text =
      "Atlas pedal steel in great shape. Asking $1,200 obo. Comes with the original case.";
    const out = removePriceTalk(text);
    expect(out).toBe("Atlas pedal steel in great shape. Comes with the original case.");
  });

  it("removes common price statements", () => {
    expect(removePriceTalk("$450 OBO")).toBe("");
    expect(removePriceTalk("Price is $450 firm.")).toBe("");
    expect(removePriceTalk("Selling for $300, no trades.")).toBe("");
    expect(removePriceTalk("Will take $275 cash.")).toBe("");
    expect(removePriceTalk("Asking price: 550")).toBe("");
    expect(removePriceTalk("Asking for $550.")).toBe("");
    expect(removePriceTalk("Yours for $99 shipped!")).toBe("");
    expect(removePriceTalk("$1,250")).toBe("");
    expect(removePriceTalk("Priced at $450.")).toBe("");
    expect(removePriceTalk("I'll take $450.")).toBe("");
    expect(removePriceTalk("I’d take $450 for it.")).toBe(""); // phone smart apostrophe
    expect(removePriceTalk("Firm at $450.")).toBe("");
    expect(removePriceTalk("$450 plus shipping.")).toBe("");
    expect(removePriceTalk("450 shipped, PayPal only.")).toBe("");
    expect(removePriceTalk("Price is 450 shipped.")).toBe("");
    expect(removePriceTalk("No lowballers, $450 is the price.")).toBe("");
    expect(removePriceTalk("Would sell for $450 or trade for a Jazzmaster.")).toBe("");
    expect(removePriceTalk("Asking only $450 for a quick sale.")).toBe("");
    expect(removePriceTalk("Asking a firm $450.")).toBe("");
    expect(removePriceTalk("Looking to get around $500.")).toBe("");
  });

  it("removes 'listing for' and stale-price phrasings (prices change; text must not pin them)", () => {
    expect(
      removePriceTalk("These sell new for $799 but I'm listing for $450.")
    ).toBe("");
    expect(removePriceTalk("Listing it at $300 this week.")).toBe("");
    expect(removePriceTalk("Was $800, now $450.")).toBe("");
    expect(removePriceTalk("On sale for $99!")).toBe("");
    expect(removePriceTalk("Sale price: $275.")).toBe("");
    expect(removePriceTalk("Reduced to $650.")).toBe("");
    // ...but "listing" in a non-price role survives
    expect(removePriceTalk("This listing is for a matched pair of speakers.")).toContain(
      "matched pair"
    );
    expect(removePriceTalk("These sell new for $799 at Sweetwater.")).toContain("$799");
  });

  it("never splits a decimal price into a new wrong price", () => {
    expect(removePriceTalk("Asking $449.99 OBO. No trades.")).toBe("No trades.");
    expect(removePriceTalk("Mint condition. Asking $1,299.99 shipped. Includes the case.")).toBe(
      "Mint condition. Includes the case."
    );
  });

  it("keeps prices that are context, not the asking price", () => {
    expect(removePriceTalk("New these run $1,200 at Sweetwater.")).toContain("$1,200");
    expect(removePriceTalk("Comes with $100 worth of cables.")).toContain("$100");
    expect(removePriceTalk("I paid $450 shipped for it last year.")).toContain("$450");
    expect(removePriceTalk("I paid about $450 shipped for it.")).toContain("$450");
    expect(removePriceTalk("Bought it for $450 cash from the original owner.")).toContain("$450");
    expect(removePriceTalk("These sell for $600 shipped on eBay all day.")).toContain("$600");
    expect(removePriceTalk("These sold for $600 shipped last month.")).toContain("$600");
    expect(removePriceTalk("These go for $600 shipped on eBay all day.")).toContain("$600");
    expect(removePriceTalk("Retails for $899 shipped.")).toContain("$899");
    expect(removePriceTalk("It retailed for $899 shipped when new.")).toContain("$899");
  });

  it("keeps other sellers' prices — that's market context, not our price", () => {
    expect(
      removePriceTalk("These are selling for $600 on Reverb right now, so this is a deal.")
    ).toContain("$600");
    expect(removePriceTalk("Others are asking $700 for these in worse shape.")).toContain("$700");
  });

  it("doesn't treat non-price numbers as prices", () => {
    expect(
      removePriceTalk("People keep asking 2 questions about this amp, so here are the answers.")
    ).toContain("2 questions");
    expect(removePriceTalk("Not asking 1960s prices here.")).toContain("1960s");
    expect(removePriceTalk("The cab will take 300 watts all day.")).toContain("300 watts");
  });

  it("keeps ordinary text untouched", () => {
    const text = "Up for sale is my Boss DD-8. Ships fast and packed well.\nQuestions welcome.";
    expect(removePriceTalk(text)).toBe(text);
  });

  it("collapses the gap a removed line leaves behind", () => {
    const out = removePriceTalk("Great amp.\n\nAsking $500 shipped.\n\nQuestions welcome.");
    expect(out).toBe("Great amp.\n\nQuestions welcome.");
  });

  it("handles empty and price-only descriptions", () => {
    expect(removePriceTalk("")).toBe("");
    expect(removePriceTalk("Asking $450.")).toBe("");
  });
});
