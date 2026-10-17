import { useEffect, useState } from "react";
import SearchForm from "../components/SearchForm";
import { api, isCloud, loadSnapshot } from "../api";
import { queueManageSearch, waitForCommand } from "../lib/inventory";

export default function SearchConfig() {
  if (isCloud) return <CloudSearches />;
  return <SearchConfigInner />;
}

// ===== Cloud search defaults =====
const CLOUD_DEFAULT_LOCATION = "Savannah, GA"; // prefilled location for new searches made from the phone

// Phone-side search management: changes are queued for the studio Mac, which
// applies them and starts sweeping immediately.
function CloudSearches() {
  const [searches, setSearches] = useState<any[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(reload = false) {
    try {
      if (reload) await loadSnapshot();
      const res = await api("/api/searches");
      const all = await res.json();
      setSearches(all.filter((s: any) => s.name !== "Discovery (automatic)"));
    } catch {
      setSearches([]);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function run(
    op: "create" | "update" | "delete",
    fields: Record<string, unknown> | undefined,
    id: number | undefined,
    successMsg: string
  ) {
    setBusy(true);
    try {
      const cmdId = await queueManageSearch(op, fields, id);
      const outcome = await waitForCommand(cmdId);
      if (!outcome) {
        alert("The studio Mac hasn't picked this up yet — is it on? It will apply as soon as it catches up.");
      } else if (outcome.status === "done") {
        await refresh(true);
        alert(successMsg);
      } else {
        alert(`The Mac couldn't do it:\n\n${outcome.error}`);
      }
    } catch (err) {
      alert(
        err instanceof Error && err.message.includes("unknown command")
          ? "The cloud needs a small update for this — tell Claude."
          : "Couldn't reach the cloud. Check your connection."
      );
    }
    setBusy(false);
    setShowForm(false);
    setEditing(null);
  }

  // The Mac's update API replaces every field, so edits always send the full set
  const fieldsFromRow = (s: any) => ({
    name: s.name,
    query: s.query,
    category: s.category || "",
    maxPrice: s.max_price ?? null,
    minDealScore: s.min_deal_score ?? 0,
    location: s.location || "",
    radiusMiles: s.radius_miles ?? 25,
    isActive: !!s.is_active,
    cronSchedule: s.cron_schedule || "*/30 * * * *",
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Searches</h1>
          <p className="text-sm text-gray-500 mt-1">
            Managed from anywhere — the studio Mac runs them and publishes what it finds.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(!showForm);
          }}
          disabled={busy}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          + New Search
        </button>
      </div>

      {busy && (
        <p className="text-sm text-indigo-600 mb-3">Sending to the studio Mac — takes up to a minute...</p>
      )}

      {(showForm || editing) && (
        <div className="bg-white rounded-lg border p-4 mb-4">
          <h2 className="text-lg font-semibold mb-3">{editing ? "Edit Search" : "New Search"}</h2>
          <SearchForm
            initial={
              editing
                ? {
                    name: editing.name,
                    query: editing.query,
                    category: editing.category || "",
                    maxPrice: editing.max_price ?? null,
                    minDealScore: editing.min_deal_score ?? 0,
                    location: editing.location || "",
                    radiusMiles: editing.radius_miles ?? 25,
                    cronSchedule: editing.cron_schedule || "*/30 * * * *",
                  }
                : undefined
            }
            defaults={{ location: CLOUD_DEFAULT_LOCATION }}
            onSubmit={(data) => {
              if (editing) {
                run(
                  "update",
                  { ...data, isActive: !!editing.is_active },
                  editing.id,
                  "Search updated — the Mac is using the new settings."
                );
              } else {
                run(
                  "create",
                  { ...data, isActive: true },
                  undefined,
                  "Search created — the Mac is sweeping it right now. New flips show on the Dashboard as they're found."
                );
              }
            }}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      {searches === null ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : searches.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-gray-500">No saved searches yet.</p>
          <p className="text-sm text-gray-400 mt-1">
            Discovery still sweeps the big categories automatically — add a search for specific
            items you're hunting.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {searches.map((s) => (
            <div key={s.id} className="bg-white rounded-lg border p-4 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-medium">
                  {s.name}{" "}
                  {!s.is_active && (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 align-middle">paused</span>
                  )}
                </h3>
                <p className="text-sm text-gray-500">
                  "{s.query}" · {s.location || "default area"} · {s.radius_miles} mi
                  {s.max_price ? ` · under $${s.max_price}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowForm(false);
                    setEditing(s);
                  }}
                  disabled={busy}
                  className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  onClick={() =>
                    run(
                      "update",
                      { ...fieldsFromRow(s), isActive: !s.is_active },
                      s.id,
                      s.is_active ? "Search paused." : "Search resumed — sweeping on its schedule again."
                    )
                  }
                  disabled={busy}
                  className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200 disabled:opacity-50"
                >
                  {s.is_active ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => {
                    if (!confirm(`Delete "${s.name}"? The listings it found disappear from the app too.`)) return;
                    run("delete", undefined, s.id, "Search deleted.");
                  }}
                  disabled={busy}
                  className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded hover:bg-red-100 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchConfigInner() {
  const [searches, setSearches] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scraping, setScraping] = useState<number | null>(null);
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [cookieText, setCookieText] = useState("");
  const [fbLoginStatus, setFbLoginStatus] = useState<"idle" | "pending">("idle");
  const [backfilling, setBackfilling] = useState(false);
  const [ebayConnected, setEbayConnected] = useState<boolean | null>(null);
  const [ebayUser, setEbayUser] = useState<{ username: string; feedbackScore: number | null } | null>(null);
  const [ebayCode, setEbayCode] = useState("");
  const [ebaySwitching, setEbaySwitching] = useState(false);

  useEffect(() => {
    api("/api/ebay/status")
      .then((r) => r.json())
      .then((d) => {
        setEbayConnected(!!d.connected);
        setEbayUser(d.user || null);
      })
      .catch(() => setEbayConnected(null));
  }, []);

  async function handleEbayConsent() {
    try {
      const res = await api("/api/ebay/consent-url");
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Set EBAY_RUNAME in .env first.");
      window.open(data.url, "_blank");
    } catch {
      alert("Couldn't reach the server. Is it running?");
    }
  }

  async function handleEbayCode() {
    try {
      const res = await api("/api/ebay/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ebayCode }),
      });
      const data = await res.json();
      if (res.ok) {
        setEbayConnected(true);
        setEbayUser(data.user || null);
        setEbaySwitching(false);
        setEbayCode("");
        alert(
          data.user
            ? `eBay connected as "${data.user.username}" — every listing posts to that account. If that's not your selling account, tap Switch eBay account.`
            : "eBay connected! Listing to eBay is now unlocked."
        );
      } else {
        alert(data.error || "That code didn't work — codes expire in ~5 minutes, try the Connect button again.");
      }
    } catch {
      alert("Couldn't reach the server. Is it running?");
    }
  }
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [showDefaultsModal, setShowDefaultsModal] = useState(false);
  const [defaultsDraft, setDefaultsDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSearches();
    api("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  async function handleDiscovery() {
    try {
      const res = await api("/api/discovery/run", { method: "POST" });
      const data = await res.json();
      alert(data.message || data.error || "Discovery triggered.");
    } catch {
      alert("Couldn't reach the server. Is it running?");
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    try {
      const res = await api("/api/pricing/backfill", { method: "POST" });
      const data = await res.json();
      alert(data.message || data.error || "Value check triggered.");
    } catch {
      alert("Couldn't reach the server. Is it running?");
    }
    setBackfilling(false);
  }

  async function handleSaveDefaults() {
    await api("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(defaultsDraft),
    });
    setSettings(defaultsDraft);
    setShowDefaultsModal(false);
  }

  function loadSearches() {
    api("/api/searches")
      .then((r) => r.json())
      .then(setSearches)
      .catch(() => {});
  }

  async function handleFbLogin() {
    setFbLoginStatus("pending");
    try {
      const res = await api("/api/scrape/facebook/login", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert("Facebook session saved! You can now run scrapes.");
      } else {
        alert(data.error || "Login failed.");
      }
    } catch {
      alert("Couldn't reach the server. Is it running?");
    }
    setFbLoginStatus("idle");
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
            onClick={handleFbLogin}
            disabled={fbLoginStatus === "pending"}
            title="Opens a Facebook login window on the computer running the server"
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {fbLoginStatus === "pending"
              ? "Waiting for login... (check the browser window)"
              : "Log in with Facebook"}
          </button>
          <button
            onClick={() => setShowCookieModal(true)}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
          >
            Paste Cookies
          </button>
          <button
            onClick={() => {
              setDefaultsDraft(settings);
              setShowDefaultsModal(true);
            }}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
          >
            Defaults
          </button>
          <button
            onClick={handleDiscovery}
            title="Sweep local marketplaces by category right now instead of waiting for the hourly run"
            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700"
          >
            Run Discovery
          </button>
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            title="Estimate market value for listings that don't have one yet (can take a few minutes)"
            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 disabled:opacity-50"
          >
            {backfilling ? "Checking values..." : "Re-check Values"}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
          >
            + New Search
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold">eBay account</h2>
            <p className="text-sm text-gray-500">
              {ebayConnected === true ? (
                ebayUser ? (
                  <>
                    Connected as <span className="font-semibold text-gray-700">{ebayUser.username}</span>
                    {ebayUser.feedbackScore != null && <> ({ebayUser.feedbackScore} feedback)</>}
                    {" — every eBay listing posts to this account."}
                  </>
                ) : (
                  "Connected — listing to eBay is unlocked."
                )
              ) : (
                "Connect once so the app can create your eBay listings."
              )}
            </p>
          </div>
          <button
            onClick={() => {
              if (ebayConnected === true) setEbaySwitching(true);
              handleEbayConsent();
            }}
            className={`px-3 py-1.5 text-sm rounded ${
              ebayConnected === true
                ? "bg-gray-200 text-gray-700 hover:bg-gray-300"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {ebayConnected === true ? "Switch eBay account" : "Connect eBay (opens sign-in)"}
          </button>
        </div>
        {ebayConnected === true && (
          <p className="text-xs text-gray-400 mt-2">
            Not the account you sell from? Tap Switch, and in the sign-in window that opens
            use "Sign out" or "Switch account" first so you can sign in with the right one.
          </p>
        )}
        {(ebayConnected !== true || ebaySwitching) && (
          <div className="flex gap-2 mt-3">
            <input
              type="text"
              value={ebayCode}
              onChange={(e) => setEbayCode(e.target.value)}
              placeholder="Paste the code from the green page here (within 5 minutes)"
              className="flex-1 border rounded p-2 text-sm"
            />
            <button
              onClick={handleEbayCode}
              disabled={!ebayCode.trim()}
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              Finish
            </button>
          </div>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 mb-4">
          <h2 className="text-lg font-semibold mb-3">New Search</h2>
          <SearchForm
            defaults={{
              location: settings.default_location,
              radiusMiles: settings.default_radius_miles,
              maxPrice: settings.default_max_price,
            }}
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
          />
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

      {showDefaultsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 max-w-md w-full">
            <h2 className="text-lg font-semibold mb-2">Search Defaults</h2>
            <p className="text-sm text-gray-500 mb-4">
              Pre-filled whenever you create a new search.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Default Location
                </label>
                <input
                  type="text"
                  value={defaultsDraft.default_location || ""}
                  onChange={(e) =>
                    setDefaultsDraft({ ...defaultsDraft, default_location: e.target.value })
                  }
                  placeholder="e.g. Savannah, GA"
                  className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Default Radius (miles)
                </label>
                <input
                  type="number"
                  value={defaultsDraft.default_radius_miles || ""}
                  onChange={(e) =>
                    setDefaultsDraft({ ...defaultsDraft, default_radius_miles: e.target.value })
                  }
                  placeholder="25"
                  className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Default Max Price ($)
                </label>
                <input
                  type="number"
                  value={defaultsDraft.default_max_price || ""}
                  onChange={(e) =>
                    setDefaultsDraft({ ...defaultsDraft, default_max_price: e.target.value })
                  }
                  placeholder="No limit"
                  className="mt-1 block w-full rounded border-gray-300 shadow-sm text-sm p-2 border"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setShowDefaultsModal(false)}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDefaults}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
              >
                Save Defaults
              </button>
            </div>
          </div>
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
