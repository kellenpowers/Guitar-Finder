import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ListingCard from "../components/ListingCard";
import { api } from "../api";

// ===== Tunables =====
// A listing makes the Top Flips board when its Flip Score (0-100, combining
// profit, ROI, sales velocity, and data confidence) clears this bar.
const MIN_FLIP_SCORE = 50;

export default function Dashboard() {
  const [allListings, setAllListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Top Flips</h1>
        <p className="text-sm text-gray-500 mt-1">
          {allListings.length} listings found / {valuedCount} valued /{" "}
          {flips.length} flips scoring {MIN_FLIP_SCORE}+
        </p>
      </div>

      {flips.length === 0 ? (
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
      )}
    </div>
  );
}
