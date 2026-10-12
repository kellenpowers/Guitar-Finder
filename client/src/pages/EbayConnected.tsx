import { copyText } from "../lib/clipboard";

// Landing page for eBay's consent redirect. Shows the authorization code so
// the owner can paste it into the Mac app (where the exchange happens, since
// the Mac holds the eBay secret). The code expires about 5 minutes after
// consent, so this page pushes urgency.
export default function EbayConnected() {
  const code = new URLSearchParams(window.location.search).get("code") || "";

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="bg-white rounded-lg border p-6 w-full max-w-lg">
        <h1 className="text-xl font-bold text-indigo-600 mb-2">eBay consent received</h1>
        {code ? (
          <>
            <p className="text-sm text-gray-600 mb-3">
              One step left, and it's time-sensitive (the code dies in ~5 minutes):
              copy the code below, open Flip Finder on the Mac
              (localhost:3001 → Searches), and paste it into the Connect eBay box.
            </p>
            <div className="bg-gray-100 rounded p-3 font-mono text-xs break-all mb-3">
              {code}
            </div>
            <button
              onClick={async () => {
                const ok = await copyText(code);
                alert(ok ? "Copied! Now paste it in the Mac app." : "Select and copy the code manually.");
              }}
              className="w-full px-3 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
            >
              Copy Code
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-600">
            No code found in this page's address. Start over from the Connect
            eBay button in the Mac app.
          </p>
        )}
      </div>
    </div>
  );
}
