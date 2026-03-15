import { useEffect, useState } from "react";
import SearchForm from "../components/SearchForm";

export default function SearchConfig() {
  const [searches, setSearches] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scraping, setScraping] = useState<number | null>(null);

  useEffect(() => {
    loadSearches();
  }, []);

  function loadSearches() {
    fetch("/api/searches").then((r) => r.json()).then(setSearches);
  }

  async function handleCreate(data: any) {
    await fetch("/api/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setShowForm(false);
    loadSearches();
  }

  async function handleUpdate(id: number, data: any) {
    await fetch(`/api/searches/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setEditingId(null);
    loadSearches();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this search?")) return;
    await fetch(`/api/searches/${id}`, { method: "DELETE" });
    loadSearches();
  }

  async function handleScrape(id: number) {
    setScraping(id);
    try {
      const res = await fetch(`/api/scrape/${id}`, { method: "POST" });
      const data = await res.json();
      alert(`Scrape complete! Found ${data.newListings} new listings.`);
    } catch {
      alert("Scrape failed. Check console for details.");
    }
    setScraping(null);
  }

  async function handleFbLogin() {
    try {
      const res = await fetch("/api/scrape/facebook/login", { method: "POST" });
      const data = await res.json();
      alert(data.message || "Login complete!");
    } catch {
      alert("Login failed.");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Saved Searches</h1>
        <div className="flex gap-2">
          <button
            onClick={handleFbLogin}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            FB Login
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
          >
            + New Search
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 mb-4">
          <h2 className="text-lg font-semibold mb-3">New Search</h2>
          <SearchForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {searches.length === 0 && !showForm ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-gray-500">No saved searches yet.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-2 text-sm text-indigo-600 hover:underline"
          >
            Create your first search
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {searches.map((search) => (
            <div key={search.id} className="bg-white rounded-lg border p-4">
              {editingId === search.id ? (
                <SearchForm
                  initial={{
                    name: search.name,
                    query: search.query,
                    category: search.category,
                    maxPrice: search.max_price,
                    minDealScore: search.min_deal_score,
                    location: search.location,
                    radiusMiles: search.radius_miles,
                    cronSchedule: search.cron_schedule,
                  }}
                  onSubmit={(data) => handleUpdate(search.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">{search.name}</h3>
                    <p className="text-sm text-gray-500">
                      Query: "{search.query}" / Location: {search.location || "Any"} /
                      Max: {search.max_price ? `$${search.max_price}` : "No limit"}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Schedule: {search.cron_schedule} / Active: {search.is_active ? "Yes" : "No"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleScrape(search.id)}
                      disabled={scraping === search.id}
                      className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {scraping === search.id ? "Scraping..." : "Run Now"}
                    </button>
                    <button
                      onClick={() => setEditingId(search.id)}
                      className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(search.id)}
                      className="px-3 py-1 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
