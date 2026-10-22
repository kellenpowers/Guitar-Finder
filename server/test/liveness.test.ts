import { describe, it, expect } from "vitest";
import { craigslistGone, facebookGone } from "../services/liveness.js";

describe("liveness detectors", () => {
  it("detects a removed Craigslist posting", () => {
    expect(craigslistGone(404, "")).toBe(true);
    expect(craigslistGone(200, "<p>This posting has been deleted by its author.</p>")).toBe(true);
    expect(craigslistGone(200, "This posting has expired.")).toBe(true);
    expect(craigslistGone(200, "This posting has been flagged for removal.")).toBe(true);
    expect(craigslistGone(200, "<h1>Crown XLS 1502 - $300</h1> great amp")).toBe(false);
  });

  it("detects a gone or sold Facebook listing without false alarms", () => {
    expect(facebookGone("Marketplace\nThis listing isn't available.")).toBe(true);
    expect(facebookGone("Marketplace\nSold\nCrown XLS 1502 amp\n$300")).toBe(true);
    expect(facebookGone("Marketplace\nPending\nCrown XLS 1502 amp")).toBe(true);
    // a live listing whose DESCRIPTION mentions selling must survive
    expect(
      facebookGone("Marketplace\nCrown XLS 1502 amp\n$300\nSavannah, GA\nSelling because I upgraded. Not sold yet!")
    ).toBe(false);
    // a login wall is not evidence the listing is gone
    expect(facebookGone("Log in to Facebook\nYou must log in to continue.")).toBe(false);
  });
});
