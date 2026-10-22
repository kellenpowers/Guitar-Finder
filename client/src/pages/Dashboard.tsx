import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ListingCard from "../components/ListingCard";
import { api, isCloud, getSnapshotUpdatedAt, getPasscode, setPasscode } from "../api";
import { meetsMarginTarget, BASE_MARGIN, SMALL_ITEM_MARGIN, MARGIN_BREAKPOINT } from "../lib/economics";
import { fetchIgnores, ignoreListing, unignoreListing } from "../lib/inventory";

function updatedAgo(): string | null {
  const ts = getSnapshotUpdatedAt();
  if (!ts) return null;
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return "updated just now";
  if (mins < 60) return `updated ${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
}

// Qualification is the owner's margin doctrine (lib/economics.ts): 100% ROI
// minimum, 200% under $100. Ranking stays by Flip Score (server order).
// Sources you drive to (shipped sources are excluded from trips)
const PICKUP_SOURCES = new Set(["facebook", "craigslist", "offerup"]);

interface TripGroup {
  location: string;
  distance: number | null;
  driveMinutes: number | null;
  listings: any[];
  totalProfit: number;
}

function groupByTrip(listings: any[]): TripGroup[] {
  const groups = new Map<string, TripGroup>();
  for (const l of listings) {
    if (!PICKUP_SOURCES.has(l.source)) continue;
    if (!l.location || !meetsMarginTarget(l)) continue;
    const key = l.location.trim().toLowerCase();
    const group: TripGroup = groups.get(key) || {
      location: l.location.trim(),
      distance: l.distance_miles ?? null,
      driveMinutes: l.drive_minutes ?? null,
      listings: [],
      totalProfit: 0,
    };
    group.listings.push(l);
    group.totalProfit += l.est_profit ?? 0;
    if (group.distance == null && l.distance_miles != null) {
      group.distance = l.distance_miles;
    }
    if (group.driveMinutes == null && l.drive_minutes != null) {
      group.driveMinutes = l.drive_minutes;
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.totalProfit - a.totalProfit);
}

const SORTS: Array<{ value: string; label: string }> = [
  { value: "flip", label: "Flip Score" },
  { value: "profit", label: "Profit" },
  { value: "score", label: "% Below Market" },
  { value: "price", label: "Price (low first)" },
  { value: "recent", label: "Newest" },
];

export default function Dashboard() {
  const [allListings, setAllListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [view, setView] = useState<"top" | "trips">("top");
  const [sortBy, setSortBy] = useState("flip");
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);

  useEffect(() => {
    setLoading(true);
    api(`/api/listings?sortBy=${sortBy}`)
      .then((r) => r.json())
      .then((listingsData) => {
        setAllListings(listingsData);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [sortBy]);

  useEffect(() => {
    fetchIgnores().then(setIgnored).catch(() => {});
  }, []);

  function ensurePasscode(): boolean {
    if (getPasscode()) return true;
    const code = prompt("Enter your Flip Finder passcode (same as the phone app):");
    if (!code) return false;
    setPasscode(code);
    return true;
  }

  async function handleIgnore(id: number) {
    if (!ensurePasscode()) return;
    setIgnored((prev) => new Set(prev).add(String(id)));
    try {
      await ignoreListing(id);
    } catch {
      setIgnored((prev) => {
        const next = new Set(prev);
        next.delete(String(id));
        return next;
      });
      alert("Couldn't save the ignore — check your connection (or the passcode) and try again.");
    }
  }

  async function handleRestore(id: number) {
    setIgnored((prev) => {
      const next = new Set(prev);
      next.delete(String(id));
      return next;
    });
    await unignoreListing(id).catch(() => {});
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border">
        <p className="text-gray-700 font-medium">Can't reach the backend server.</p>
        <p className="text-sm text-gray-500 mt-1">
          Make sure it's running (npm start), then refresh this page.
        </p>
      </div>
    );
  }

  const visible = allListings.filter((l) => !ignored.has(String(l.id)));
  const flips = visible.filter(meetsMarginTarget);
  const ignoredFlips = allListings.filter(
    (l) => ignored.has(String(l.id)) && meetsMarginTarget(l)
  );
  const valuedCount = visible.filter((l) => l.estimated_market_value != null).length;
  const trips = groupByTrip(visible);

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            {view === "top" ? "Top Flips" : "Flips by Trip"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {view === "top"
              ? `${allListings.length} listings found / ${valuedCount} valued / ${flips.length} flips at ${BASE_MARGIN * 100}%+ margin (${SMALL_ITEM_MARGIN * 100}% under $${MARGIN_BREAKPOINT})`
              : `${trips.length} towns with pickups meeting your margin — one drive grabs them all`}
            {isCloud && updatedAgo() && (
              <span className="text-gray-400"> · {updatedAgo()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {view === "top" && (
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="text-sm border rounded-lg px-2 py-1.5 bg-white text-gray-700"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  Sort: {s.label}
                </option>
              ))}
            </select>
          )}
          <div className="flex rounded-lg border overflow-hidden text-sm">
            <button
              onClick={() => setView("top")}
              className={`px-3 py-1.5 ${view === "top" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Top Flips
            </button>
            <button
              onClick={() => setView("trips")}
              className={`px-3 py-1.5 ${view === "trips" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              By Trip
            </button>
          </div>
        </div>
      </div>

      {view === "top" ? (
        flips.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border">
            {allListings.length === 0 ? (
              <>
                <p className="text-gray-500">No listings yet.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Discovery sweeps your local marketplaces automatically every hour
                  while the app is running — the first sweep starts shortly after
                  launch. You can also add targeted{" "}
                  <Link to="/searches" className="text-indigo-600 hover:underline">
                    searches
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <p className="text-gray-500">
                  Nothing meeting your {BASE_MARGIN * 100}% margin target yet.
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  Discovery keeps sweeping hourly. Browse everything on the{" "}
                  <Link to="/listings" className="text-indigo-600 hover:underline">
                    All Listings
                  </Link>{" "}
                  page.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {flips.map((listing) => (
              <ListingCard key={listing.id} listing={listing} onIgnore={handleIgnore} />
            ))}
          </div>
        )
      ) : trips.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-gray-500">No profitable local pickups yet.</p>
          <p className="text-sm text-gray-400 mt-1">
            Trips appear once local listings are valued — shipped sources (eBay,
            Reverb) aren't included here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {trips.map((trip) => (
            <div key={trip.location}>
              <div className="flex items-baseline gap-3 mb-2">
                <h2 className="text-lg font-semibold">{trip.location}</h2>
                <span className="text-sm text-gray-500">
                  {trip.listings.length}{" "}
                  {trip.listings.length === 1 ? "pickup" : "pickups"} · ~$
                  {Math.round(trip.totalProfit).toLocaleString()} total profit
                  {trip.driveMinutes != null
                    ? ` · ~${Math.round(trip.driveMinutes)} min drive`
                    : trip.distance != null
                      ? ` · ${Math.round(trip.distance)} mi away`
                      : ""}
                </span>
              </div>
              <div className="space-y-3">
                {trip.listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} onIgnore={handleIgnore} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "top" && ignoredFlips.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowIgnored(!showIgnored)}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            {showIgnored ? "Hide" : "Show"} ignored ({ignoredFlips.length})
          </button>
          {showIgnored && (
            <div className="space-y-3 mt-3 opacity-60">
              {ignoredFlips.map((listing) => (
                <div key={listing.id} className="relative">
                  <ListingCard listing={listing} />
                  <button
                    onClick={() => handleRestore(listing.id)}
                    className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-white border text-gray-600 hover:bg-gray-50"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
