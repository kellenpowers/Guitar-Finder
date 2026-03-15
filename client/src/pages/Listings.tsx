import { useEffect, useState } from "react";
import ListingCard from "../components/ListingCard";
import { api } from "../api";

export default function Listings() {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("score");
  const [source, setSource] = useState("");
  const [minScore, setMinScore] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sortBy) params.set("sortBy", sortBy);
    if (source) params.set("source", source);
    if (minScore) params.set("minScore", minScore);

    api(`/api/listings?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setListings(data);
        setLoading(false);
      });
  }, [sortBy, source, minScore]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">All Listings</h1>
        <div className="flex gap-3 items-center">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-sm border rounded p-1.5"
          >
            <option value="score">Best Deals</option>
            <option value="price">Lowest Price</option>
            <option value="recent">Most Recent</option>
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="text-sm border rounded p-1.5"
          >
            <option value="">All Sources</option>
            <option value="facebook">FB Marketplace</option>
            <option value="craigslist">Craigslist</option>
          </select>
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            placeholder="Min score %"
            className="text-sm border rounded p-1.5 w-28"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : listings.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-gray-500">No listings found.</p>
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
