import { Routes, Route, Link } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import SearchConfig from "./pages/SearchConfig";
import Listings from "./pages/Listings";

export default function App() {
  return (
    <div className="min-h-screen">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <Link to="/" className="text-xl font-bold text-indigo-600">
            Deal Finder
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
