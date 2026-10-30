import { describe, it, expect } from "vitest";
import { remoteCitiesForSweep, REMOTE_CITIES } from "../services/discovery.js";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-30T10:05:00Z");

describe("remoteCitiesForSweep (250-mile radius rotation)", () => {
  it("picks a small, fixed number of remote metros per sweep", () => {
    const picked = remoteCitiesForSweep(T0);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(3); // polite: the hourly FB load must stay small
    for (const c of picked) {
      expect(REMOTE_CITIES).toContainEqual(c);
    }
  });

  it("is stable within an hour and moves on the next", () => {
    expect(remoteCitiesForSweep(T0)).toEqual(remoteCitiesForSweep(T0 + 10 * 60_000));
    expect(remoteCitiesForSweep(T0 + HOUR)).not.toEqual(remoteCitiesForSweep(T0));
  });

  it("covers EVERY metro in the circle over a day of sweeps", () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h++) {
      for (const c of remoteCitiesForSweep(T0 + h * HOUR)) seen.add(c.location);
    }
    expect(seen.size).toBe(REMOTE_CITIES.length);
  });

  it("every metro has a Craigslist site and a geocodable location", () => {
    for (const c of REMOTE_CITIES) {
      expect(c.cl).toMatch(/^[a-z]+$/);
      expect(c.location).toMatch(/^[A-Za-z .]+, [A-Z]{2}$/);
    }
  });
});
