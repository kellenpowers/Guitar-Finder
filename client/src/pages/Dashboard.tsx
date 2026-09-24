import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ListingCard from "../components/ListingCard";
import { api } from "../api";

export default function Dashboard() {
  const [allListings, setAllListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchCount, setSearchCount] = useState(0);

  useEffect(() => {
    Promise.all([
      api("/api/listings?sortBy=score").then((r) => r.json()),
      api("/api/searches").then((r) => r.json()),
    ])
      .then(([listingsData, searches]) => {
        setAllListings(listingsData);
        setSearchCount(searches.length);
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

  const deals = allListings.filter((l) => (l.deal_score ?? 0) >= 10);
  const hasMarketValues = allListings.some((l) => l.estimated_market_value != null);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Top Deals</h1>
        <p className="text-sm text-gray-500 mt-1">
          {searchCount} active searches / {allListings.length} listings scraped /{" "}
          {deals.length} deals found
        </p>
      </div>

      {deals.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          {allListings.length === 0 ? (
            <>
              <p className="text-gray-500">No listings yet.</p>
              <p className="text-sm text-gray-400 mt-1">
                Go to{" "}
                <Link to="/searches" className="text-indigo-600 hover:underline">
                  Searches
                </Link>{" "}
                to create a search and run a scrape.
              </p>
            </>
          ) : (
            <>
              <p className="text-gray-500">
                {allListings.length} listings scraped, but none scored as a deal yet.
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Browse everything on the{" "}
                <Link to="/listings" className="text-indigo-600 hover:underline">
                  All Listings
                </Link>{" "}
                page.
              </p>
              {!hasMarketValues && (
                <p className="text-sm text-amber-600 mt-3 max-w-md mx-auto">
                  Deal scoring is off because no Reverb prices were found. Add your
                  REVERB_API_TOKEN to the .env file (see README), then re-run a scrape.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {deals.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
