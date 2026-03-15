import { useState } from "react";

interface SearchFormProps {
  initial?: {
    name: string;
    query: string;
    category: string;
    maxPrice: number | null;
    minDealScore: number;
    location: string;
    radiusMiles: number;
    cronSchedule: string;
  };
  onSubmit: (data: any) => void;
  onCancel?: () => void;
}

export default function SearchForm({ initial, onSubmit, onCancel }: SearchFormProps) {
  const [name, setName] = useState(initial?.name || "");
  const [query, setQuery] = useState(initial?.query || "");
  const [category, setCategory] = useState(initial?.category || "");
  const [maxPrice, setMaxPrice] = useState(initial?.maxPrice?.toString() || "");
  const [minDealScore, setMinDealScore] = useState(initial?.minDealScore?.toString() || "20");
  const [location, setLocation] = useState(initial?.location || "");
  const [radiusMiles, setRadiusMiles] = useState(initial?.radiusMiles?.toString() || "25");
  const [cronSchedule, setCronSchedule] = useState(initial?.cronSchedule || "*/30 * * * *");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      query,
      category,
      maxPrice: maxPrice ? Number(maxPrice) : null,
      minDealScore: Number(minDealScore),
      location,
      radiusMiles: Number(radiusMiles),
      cronSchedule,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fender Strats under $500"
            className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Search Query</label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Fender Stratocaster"
            className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Category</label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. guitars, pedals, amps"
            className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Max Price ($)</label>
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="No limit"
            className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Min Deal Score (%)</label>
          <input
            type="number"
            value={minDealScore}
            onChange={(e) => setMinDealScore(e.target.value)}
            min="0"
            max="100"
            className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Austin, TX"
            className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Radius (miles)</label>
          <input
            type="number"
            value={radiusMiles}
            onChange={(e) => setRadiusMiles(e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Schedule (cron)</label>
          <input
            type="text"
            value={cronSchedule}
            onChange={(e) => setCronSchedule(e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
          />
          <p className="text-xs text-gray-400 mt-1">Default: every 30 min</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
        >
          {initial ? "Update Search" : "Create Search"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
