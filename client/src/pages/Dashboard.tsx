import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ListingCard from "../components/ListingCard";
import { api } from "../api";

// ===== Tunables =====
// A listing makes the Top Flips board when its Flip Score (0-100, combining
// profit, ROI, sales velocity, and data confidence) clears this bar.
const MIN_FLIP_SCORE = 50;
// The By Trip view includes any profitable pickup, even below the score bar —
// a marginal item is worth grabbing when you're driving there anyway.
const TRIP_MIN_PROFIT = 20;
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
    if (!l.location || (l.est_profit ?? 0) < TRIP_MIN_PROFIT) continue;
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

export default function Dashboard() {
  const [allListings, setAllListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [view, setView] = useState<"top" | "trips">("top");

  useEffect(() => {
    api("/api/listings?sortBy=flip")
      .then((r) => r.json())
      .then((listingsData) => {
        setAllListings(listingsData);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

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

  const flips = allListings.filter((l) => (l.flip_score ?? -1) >= MIN_FLIP_SCORE);
  const valuedCount = allListings.filter((l) => l.estimated_market_value != null).length;
  const trips = groupByTrip(allListings);

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            {view === "top" ? "Top Flips" : "Flips by Trip"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {view === "top"
              ? `${allListings.length} listings found / ${valuedCount} valued / ${flips.length} flips scoring ${MIN_FLIP_SCORE}+`
              : `${trips.length} towns with profitable pickups — one drive grabs them all`}
          </p>
        </div>
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
                  Nothing scoring {MIN_FLIP_SCORE}+ as a flip yet.
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
              <ListingCard key={listing.id} listing={listing} />
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
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
