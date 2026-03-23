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
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden hover:shadow-md transition-shadow">
      <div className="flex">
        {listing.image_url ? (
          <img
            src={listing.image_url}
            alt={listing.title}
            className="w-32 h-32 object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-32 h-32 bg-gray-200 flex items-center justify-center flex-shrink-0">
            <span className="text-gray-400 text-xs">No image</span>
          </div>
        )}
        <div className="p-3 flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <a
              href={listing.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-sm text-gray-900 hover:text-indigo-600 line-clamp-2"
            >
              {listing.title}
            </a>
            <span className="text-lg font-bold text-green-700 flex-shrink-0">
              ${listing.price.toLocaleString()}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
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
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            <span>{listing.source === "facebook" ? "FB Marketplace" : "Craigslist"}</span>
            {listing.location && <span>{listing.location}</span>}
            <span>{new Date(listing.scraped_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
