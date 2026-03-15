import { useEffect, useState } from "react";
import ListingCard from "../components/ListingCard";
import { api } from "../api";

export default function Dashboard() {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalListings: 0, totalSearches: 0 });

  useEffect(() => {
    Promise.all([
      api("/api/listings?sortBy=score&minScore=10").then((r) => r.json()),
      api("/api/searches").then((r) => r.json()),
    ]).then(([listingsData, searches]) => {
      setListings(listingsData);
      setStats({
        totalListings: listingsData.length,
        totalSearches: searches.length,
      });
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Top Deals</h1>
        <p className="text-sm text-gray-500 mt-1">
          {stats.totalSearches} active searches / {stats.totalListings} deals found
        </p>
      </div>

      {listings.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-gray-500">No deals found yet.</p>
          <p className="text-sm text-gray-400 mt-1">
            Create a search and run a scrape to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
