import { describe, it, expect } from "vitest";
import { titleConsensus, parseIdentityJson, isLikelyAccessory } from "../services/identify.js";

describe("titleConsensus (eBay image-match agreement)", () => {
  it("is confident when the top matches clearly agree", () => {
    const r = titleConsensus([
      "Bose 301 Series V Direct/Reflecting Speakers Pair Black",
      "Bose 301 Series V Speakers - Pair",
      "BOSE 301 series V bookshelf speakers pair",
      "Bose 301-V Stereo Speakers",
    ]);
    expect(r.confident).toBe(true);
    expect(r.title.toLowerCase()).toContain("bose 301");
  });

  it("is not confident when the matches disagree", () => {
    const r = titleConsensus([
      "Sony WH-1000XM4 Headphones",
      "Vintage brass table lamp",
      "DeWalt 20V drill driver kit",
      "Pioneer DJ controller DDJ-400",
    ]);
    expect(r.confident).toBe(false);
  });

  it("handles empty and single-result lists", () => {
    expect(titleConsensus([]).confident).toBe(false);
    const one = titleConsensus(["Shure SM57 microphone"]);
    expect(one.confident).toBe(false);
    expect(one.title).toBe("Shure SM57 microphone"); // still offered as a candidate
  });

  it("never lets an accessory listing win (cases, stands, mounts FOR the item)", () => {
    const r = titleConsensus([
      "Case for Bose 301 Series V Speakers",
      "Speaker Stands for Bose 301 Series V",
      "Grille Covers for Bose 301 Series V",
      "Wall Mount Brackets for Bose 301 Series V Speakers",
      "Bose 301 Series V Direct/Reflecting Speakers Pair",
    ]);
    expect(r.title).toBe("Bose 301 Series V Direct/Reflecting Speakers Pair");
    expect(isLikelyAccessory("Case for Bose 301 Series V Speakers")).toBe(true);
    expect(isLikelyAccessory("Bose 301 Series V Speakers Pair")).toBe(false);
  });

  it("dedupes a one-seller relisting flood before scoring", () => {
    const r = titleConsensus([
      "Replacement Foam Surround Kit for Bose 301 Speakers",
      "Replacement Foam Surround Kit for Bose 301 Speakers",
      "Replacement Foam Surround Kit for Bose 301 Speakers",
      "Bose 301 Series V Speakers Pair Black",
      "Bose 301 Series V bookshelf speakers, working pair",
    ]);
    expect(r.title.toLowerCase()).not.toContain("foam");
  });

  it("prefers detailed titles over short generic subsets", () => {
    const r = titleConsensus([
      "Bose 301",
      "Bose 301 Series V Direct/Reflecting Bookshelf Speakers Pair Black",
      "Bose 301 Series V Speakers Pair, tested working",
      "Bose 301 Series V Direct Reflecting Speakers",
    ]);
    expect(r.title).not.toBe("Bose 301");
    expect(r.title.toLowerCase()).toContain("series v");
  });
});

describe("parseIdentityJson (Claude reply parsing)", () => {
  it("parses a plain JSON reply", () => {
    const r = parseIdentityJson(
      '{"title": "Bose 301 Series V Speakers Pair", "description": "Clean pair of bookshelf speakers.", "condition_notes": "Light scuffs on one corner.", "questions": ["Do both drivers work?"]}'
    );
    expect(r?.title).toBe("Bose 301 Series V Speakers Pair");
    expect(r?.questions).toEqual(["Do both drivers work?"]);
  });

  it("parses JSON wrapped in a code fence or prose", () => {
    const r = parseIdentityJson(
      'Here you go:\n```json\n{"title": "Shure SM57", "questions": []}\n```'
    );
    expect(r?.title).toBe("Shure SM57");
  });

  it("returns null for garbage or missing title", () => {
    expect(parseIdentityJson("I cannot tell what this is.")).toBeNull();
    expect(parseIdentityJson('{"description": "a thing"}')).toBeNull();
    expect(parseIdentityJson('{"title": {"nested": "not a string"}}')).toBeNull();
  });

  it("survives stray braces in surrounding prose", () => {
    const r = parseIdentityJson(
      'Looking at the photos {hard to tell at first} here it is: {"title": "Shure SM57", "questions": []} {hope that helps}'
    );
    expect(r?.title).toBe("Shure SM57");
    const r2 = parseIdentityJson('{"title": "Boss DD-8 delay pedal"} with {standard} fields');
    expect(r2?.title).toBe("Boss DD-8 delay pedal");
  });

  it("caps title length and question count", () => {
    const long = "x".repeat(200);
    const r = parseIdentityJson(
      `{"title": "${long}", "questions": ["a", "b", "c", "d", "e"]}`
    );
    expect(r?.title.length).toBe(80);
    expect(r?.questions?.length).toBe(3);
  });
});
