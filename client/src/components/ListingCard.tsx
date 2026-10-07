import { useState } from "react";
import DealBadge from "./DealBadge";
import { api } from "../api";

interface ListingCardProps {
  listing: {
    id: number;
    title: string;
    price: number;
    image_url: string;
    listing_url: string;
    location: string;
    source: string;
    scraped_at: string;
    deal_score: number | null;
    estimated_market_value: number | null;
    value_source?: string | null;
    savings: number | null;
    est_profit?: number | null;
  };
}

interface Comparable {
  title: string;
  price: number;
  condition: string;
  url: string;
}

// Real-sales sources vs. asking-price estimates, so the user knows the quality
const VALUE_SOURCE_LABELS: Record<string, string> = {
  reverb_price_guide: "Reverb sales",
  ebay_sold: "eBay sold",
  reverb_asking: "Reverb asking",
};

export default function ListingCard({ listing }: ListingCardProps) {
  const [showComps, setShowComps] = useState(false);
  const [comps, setComps] = useState<Comparable[] | null>(null);
  const [compsSource, setCompsSource] = useState<string>("");

  async function openComps(e: React.MouseEvent) {
    // The whole card is a link to the marketplace listing — don't follow it
    e.preventDefault();
    e.stopPropagation();
    setShowComps(true);
    if (comps !== null) return;
    try {
      const res = await api(`/api/listings/${listing.id}`);
      const data = await res.json();
      setComps(JSON.parse(data.reverb_listings || "[]"));
      setCompsSource(data.value_source || "");
    } catch {
      setComps([]);
    }
  }

  const sourceLabel = listing.value_source
    ? VALUE_SOURCE_LABELS[listing.value_source] || ""
    : "";

  return (
    <>
      <a
        href={listing.listing_url}
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-white rounded-lg shadow-sm border overflow-hidden hover:shadow-md hover:ring-2 hover:ring-indigo-300 transition-all cursor-pointer"
      >
        <div className="flex">
          {listing.image_url ? (
            <img
              src={listing.image_url}
              alt={listing.title}
              className="w-44 h-44 object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-44 h-44 bg-gray-200 flex items-center justify-center flex-shrink-0">
              <span className="text-gray-400 text-xs">No image</span>
            </div>
          )}
          <div className="p-4 flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-base text-gray-900 line-clamp-2">
                {listing.title}
              </span>
              <span className="text-xl font-bold text-green-700 flex-shrink-0">
                ${listing.price.toLocaleString()}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <DealBadge score={listing.deal_score} />
              {listing.estimated_market_value && (
                <span className="text-xs text-gray-500">
                  Est. value: ${listing.estimated_market_value.toLocaleString()}
                  {sourceLabel ? ` (${sourceLabel})` : ""}
                </span>
              )}
              {listing.est_profit != null && listing.est_profit > 0 ? (
                <span className="text-xs text-green-600 font-bold">
                  ~${listing.est_profit.toLocaleString()} profit after fees
                </span>
              ) : (
                listing.savings != null &&
                listing.savings > 0 && (
                  <span className="text-xs text-green-600 font-medium">
                    Save ${listing.savings.toLocaleString()}
                  </span>
                )
              )}
              {listing.estimated_market_value && (
                <button
                  onClick={openComps}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  See comps
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
              <span>
                {{
                  facebook: "FB Marketplace",
                  craigslist: "Craigslist",
                  ebay: "eBay",
                  offerup: "OfferUp",
                  reverb: "Reverb",
                }[listing.source] || listing.source}
              </span>
              {listing.location && <span>{listing.location}</span>}
              <span>{new Date(listing.scraped_at).toLocaleDateString()}</span>
            </div>
            <div className="mt-2 text-xs text-indigo-500">
              Click to open listing →
            </div>
          </div>
        </div>
      </a>

      {showComps && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowComps(false)}
        >
          <div
            className="bg-white rounded-lg p-5 max-w-lg w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-1">Comparables</h2>
            <p className="text-sm text-gray-500 mb-3">
              {listing.title} — est. value $
              {listing.estimated_market_value?.toLocaleString()}
              {sourceLabel ? ` (${sourceLabel})` : ""}
            </p>

            {comps === null ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : comps.length === 0 ? (
              <p className="text-sm text-gray-500">
                {compsSource === "reverb_price_guide"
                  ? "This estimate comes from Reverb's price guide, which aggregates many real sales — individual comps aren't listed."
                  : "No individual comparables were stored for this estimate."}
              </p>
            ) : (
              <div className="space-y-2">
                {comps.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 border rounded p-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 truncate">{c.title}</p>
                      <p className="text-xs text-gray-400">{c.condition}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-semibold text-gray-700">
                        ${c.price.toLocaleString()}
                      </span>
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          View
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowComps(false)}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
