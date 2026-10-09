import { useEffect, useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import SearchConfig from "./pages/SearchConfig";
import Listings from "./pages/Listings";
import { isCloud, getPasscode, setPasscode, loadSnapshot } from "./api";

function PasscodeGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "wrong">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("checking");
    setPasscode(code);
    try {
      await loadSnapshot();
      onUnlocked();
    } catch {
      setStatus("wrong");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-lg border p-6 w-full max-w-sm">
        <h1 className="text-xl font-bold text-indigo-600 mb-1">Flip Finder</h1>
        <p className="text-sm text-gray-500 mb-4">Enter your passcode to see the latest flips.</p>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Passcode"
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full border rounded p-2 text-sm mb-3"
        />
        {status === "wrong" && (
          <p className="text-sm text-red-600 mb-3">That passcode didn't work — try again.</p>
        )}
        <button
          type="submit"
          disabled={status === "checking" || !code.trim()}
          className="w-full px-3 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {status === "checking" ? "Checking..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(!isCloud);
  const [checking, setChecking] = useState(isCloud && !!getPasscode());

  useEffect(() => {
    if (isCloud && getPasscode()) {
      loadSnapshot()
        .then(() => setUnlocked(true))
        .catch(() => {})
        .finally(() => setChecking(false));
    }
  }, []);

  if (!unlocked) {
    if (checking) {
      return <div className="text-center py-12 text-gray-500">Loading...</div>;
    }
    return <PasscodeGate onUnlocked={() => setUnlocked(true)} />;
  }

  return (
    <div className="min-h-screen">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4 sm:gap-6 flex-wrap">
          <Link to="/" className="text-xl font-bold text-indigo-600">
            Flip Finder
          </Link>
          <Link to="/" className="text-sm text-gray-600 hover:text-gray-900">
            Dashboard
          </Link>
          <Link to="/searches" className="text-sm text-gray-600 hover:text-gray-900">
            Searches
          </Link>
          <Link to="/listings" className="text-sm text-gray-600 hover:text-gray-900">
            All Listings
          </Link>
          {isCloud && (
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-indigo-600 hover:underline ml-auto"
            >
              Refresh
            </button>
          )}
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/searches" element={<SearchConfig />} />
          <Route path="/listings" element={<Listings />} />
        </Routes>
      </main>
    </div>
  );
}
