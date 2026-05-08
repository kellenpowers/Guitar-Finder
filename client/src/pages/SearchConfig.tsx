import { useEffect, useState } from "react";
import SearchForm from "../components/SearchForm";
import { api } from "../api";

export default function SearchConfig() {
  const [searches, setSearches] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scraping, setScraping] = useState<number | null>(null);
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [cookieText, setCookieText] = useState("");

  useEffect(() => {
    loadSearches();
  }, []);

  function loadSearches() {
    api("/api/searches").then((r) => r.json()).then(setSearches);
  }

  async function handleCreate(data: any) {
    await api("/api/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setShowForm(false);
    loadSearches();
  }

  async function handleUpdate(id: number, data: any) {
    await api(`/api/searches/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setEditingId(null);
    loadSearches();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this search?")) return;
    await api(`/api/searches/${id}`, { method: "DELETE" });
    loadSearches();
  }

  async function handleScrape(id: number) {
    setScraping(id);
    try {
      const res = await api(`/api/scrape/${id}`, { method: "POST" });
      const data = await res.json();
      alert(`Scrape complete! Found ${data.newListings} new listings.`);
    } catch {
      alert("Scrape failed. Check console for details.");
    }
    setScraping(null);
  }

  async function handleCookieSubmit() {
    try {
      const cookies = JSON.parse(cookieText);
      const res = await api("/api/scrape/facebook/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: Array.isArray(cookies) ? cookies : [cookies] }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Cookies saved!");
        setShowCookieModal(false);
        setCookieText("");
      } else {
        alert(data.error || "Failed to save cookies.");
      }
    } catch {
      alert("Invalid JSON. Make sure you copied the cookies correctly.");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Saved Searches</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCookieModal(true)}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            FB Cookies
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

      {showCookieModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 max-w-lg w-full">
            <h2 className="text-lg font-semibold mb-2">Paste Facebook Cookies</h2>
            <p className="text-sm text-gray-500 mb-3">
              1. Log in to facebook.com in your browser<br />
              2. Install a cookie export extension (e.g. "EditThisCookie" or "Cookie-Editor")<br />
              3. Export cookies as JSON and paste below
            </p>
            <textarea
              value={cookieText}
              onChange={(e) => setCookieText(e.target.value)}
              placeholder='[{"name": "c_user", "value": "...", "domain": ".facebook.com", ...}]'
              className="w-full h-40 border rounded p-2 text-xs font-mono mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowCookieModal(false); setCookieText(""); }}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleCookieSubmit}
                disabled={!cookieText.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Save Cookies
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
