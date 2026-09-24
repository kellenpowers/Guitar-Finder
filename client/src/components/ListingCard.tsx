import DealBadge from "./DealBadge";

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
    savings: number | null;
  };
}

export default function ListingCard({ listing }: ListingCardProps) {
  return (
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
                Reverb: ${listing.estimated_market_value.toLocaleString()}
              </span>
            )}
            {listing.savings && listing.savings > 0 && (
              <span className="text-xs text-green-600 font-medium">
                Save ${listing.savings.toLocaleString()}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
            <span>{listing.source === "facebook" ? "FB Marketplace" : "Craigslist"}</span>
            {listing.location && <span>{listing.location}</span>}
            <span>{new Date(listing.scraped_at).toLocaleDateString()}</span>
          </div>
          <div className="mt-2 text-xs text-indigo-500">
            Click to open listing →
          </div>
        </div>
      </div>
    </a>
  );
}
