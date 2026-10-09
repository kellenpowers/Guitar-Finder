import { getDb } from "../db/index.js";

// ===== Distance tunables =====
const GEOCODES_PER_RUN = 25; // max new city lookups per pass (politeness)
const GEOCODE_DELAY_MS = 1100; // Nominatim asks for ~1 request/second
const LOCAL_SOURCES = ["facebook", "craigslist", "offerup"]; // pickup-in-person sources

export function haversineMiles(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // earth radius in miles
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// City -> coordinates via OpenStreetMap's Nominatim, cached forever in the DB
// so each unique city is looked up exactly once.
async function geocode(db: any, place: string): Promise<{ lat: number; lon: number } | null> {
  const key = place.trim().toLowerCase();
  if (!key) return null;

  const cached = db.prepare("SELECT lat, lon FROM geocache WHERE place = ?").get(key);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({
      q: place,
      format: "json",
      limit: "1",
      countrycodes: "us",
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": "GuitarDealFinder/1.0 (personal deal finder)" },
    });
    await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS));
    if (!res.ok) return null;

    const data = await res.json();
    const hit = data?.[0];
    if (!hit?.lat || !hit?.lon) return null;

    const coords = { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon) };
    db.prepare("INSERT OR REPLACE INTO geocache (place, lat, lon) VALUES (?, ?, ?)").run(
      key, coords.lat, coords.lon
    );
    return coords;
  } catch (err) {
    console.error(`Geocoding failed for "${place}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Fill in distance_miles (from the user's default location) for local-pickup
// listings that don't have one yet. Safe to call often — cached cities are free.
export async function applyDistances(): Promise<number> {
  const db = getDb();
  const home = (
    db.prepare("SELECT value FROM settings WHERE key = 'default_location'").get() as
      | { value: string }
      | undefined
  )?.value;
  if (!home) return 0;

  const homeCoords = await geocode(db, home);
  if (!homeCoords) {
    console.warn(`Couldn't geocode home location "${home}" — distances skipped.`);
    return 0;
  }

  const placeholders = LOCAL_SOURCES.map(() => "?").join(",");
  const locations = db
    .prepare(
      `SELECT DISTINCT location FROM listings
       WHERE distance_miles IS NULL AND location <> '' AND source IN (${placeholders})`
    )
    .all(...LOCAL_SOURCES) as Array<{ location: string }>;

  let updated = 0;
  let newLookups = 0;
  for (const { location } of locations) {
    const wasCached = !!db
      .prepare("SELECT 1 FROM geocache WHERE place = ?")
      .get(location.trim().toLowerCase());
    if (!wasCached && newLookups >= GEOCODES_PER_RUN) continue; // next run picks it up
    if (!wasCached) newLookups++;

    const coords = await geocode(db, location);
    if (!coords) continue;

    const miles = Math.round(
      haversineMiles(homeCoords.lat, homeCoords.lon, coords.lat, coords.lon)
    );
    const result = db
      .prepare(
        `UPDATE listings SET distance_miles = ? WHERE location = ? AND distance_miles IS NULL AND source IN (${placeholders})`
      )
      .run(miles, location, ...LOCAL_SOURCES);
    updated += result.changes;
  }

  if (updated > 0) console.log(`Distances computed for ${updated} listings.`);
  return updated;
}
