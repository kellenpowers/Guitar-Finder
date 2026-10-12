import { useEffect, useState } from "react";
import { getPasscode, setPasscode } from "../api";
import {
  listInventory, createItem, updateItem, deleteItem, uploadPhoto, photoUrl,
  generateListingDraft, queueListOnReverb, type InventoryItem,
} from "../lib/inventory";
import { copyText } from "../lib/clipboard";

const STATUSES: InventoryItem["status"][] = ["prepping", "listed", "sold"];

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState("");
  const [hasCode, setHasCode] = useState(!!getPasscode());
  const [codeInput, setCodeInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBought, setNewBought] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setItems(await listInventory());
      setError("");
    } catch (err) {
      if (err instanceof Error && err.message === "bad-passcode") {
        setPasscode("");
        setHasCode(false);
      } else {
        setError("Couldn't load inventory. Check your connection and refresh.");
      }
    }
  }

  useEffect(() => {
    if (hasCode) load();
  }, [hasCode]);

  if (!hasCode) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPasscode(codeInput);
          setHasCode(true);
        }}
        className="max-w-sm mx-auto bg-white rounded-lg border p-5 mt-8"
      >
        <h2 className="text-lg font-semibold mb-2">Inventory</h2>
        <p className="text-sm text-gray-500 mb-3">
          Enter your passcode to open your inventory (same one as the phone app).
        </p>
        <input
          type="text"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder="Passcode"
          autoCapitalize="none"
          className="w-full border rounded p-2 text-sm mb-3"
        />
        <button
          type="submit"
          disabled={!codeInput.trim()}
          className="w-full px-3 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          Unlock
        </button>
      </form>
    );
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const target = newTarget ? Number(newTarget) : null;
    const item = await createItem({
      title: newTitle.trim(),
      bought_price: newBought ? Number(newBought) : null,
      target_price: target,
      listing_draft: generateListingDraft(newTitle.trim(), target),
    }).catch(() => null);
    if (!item) return alert("Couldn't add the item. Try again.");
    setItems((prev) => [item, ...(prev || [])]);
    setNewTitle(""); setNewBought(""); setNewTarget(""); setShowAdd(false);
  }

  async function handlePhotos(item: InventoryItem, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusyId(item.id);
    try {
      const paths = [...item.photos];
      for (const file of Array.from(files)) {
        paths.push(await uploadPhoto(file));
      }
      const updated = await updateItem(item.id, { photos: paths });
      setItems((prev) => (prev || []).map((i) => (i.id === item.id ? updated : i)));
    } catch {
      alert("A photo failed to upload. Try again.");
    }
    setBusyId(null);
  }

  async function saveField(item: InventoryItem, fields: Partial<InventoryItem>) {
    const updated = await updateItem(item.id, fields).catch(() => null);
    if (updated) {
      setItems((prev) => (prev || []).map((i) => (i.id === item.id ? updated : i)));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-gray-500 mt-1">
            Items you bought, photos, and the listing text to paste when you resell.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load()}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
          >
            Refresh
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
          >
            + Add Item
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white rounded-lg border p-4 mb-4 space-y-3">
          <input
            type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="What is it? e.g. Shure SM7B microphone" required
            className="w-full border rounded p-2 text-sm"
          />
          <div className="flex gap-3">
            <input
              type="number" value={newBought} onChange={(e) => setNewBought(e.target.value)}
              placeholder="Paid $" className="border rounded p-2 text-sm w-32"
            />
            <input
              type="number" value={newTarget} onChange={(e) => setNewTarget(e.target.value)}
              placeholder="Target sale $" className="border rounded p-2 text-sm w-32"
            />
            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700">
              Add
            </button>
          </div>
        </form>
      )}

      {items === null ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-gray-500">Nothing in inventory yet.</p>
          <p className="text-sm text-gray-400 mt-1">
            Tap Bought on a flip, or add an item here, then add photos from your phone.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="bg-white rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h3 className="font-medium">{item.title}</h3>
                  <p className="text-sm text-gray-500">
                    {item.bought_price != null && <>Paid ${item.bought_price.toLocaleString()} · </>}
                    {item.target_price != null && <>Target ${item.target_price.toLocaleString()} · </>}
                    Added {new Date(item.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={item.status}
                    onChange={(e) => saveField(item, { status: e.target.value as InventoryItem["status"] })}
                    className="text-sm border rounded p-1.5"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      if (!confirm("Remove this item from inventory?")) return;
                      deleteItem(item.id).then(() =>
                        setItems((prev) => (prev || []).filter((i) => i.id !== item.id))
                      );
                    }}
                    className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded hover:bg-red-100"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {item.photos.map((p) => (
                  <a key={p} href={photoUrl(p)} target="_blank" rel="noopener noreferrer">
                    <img src={photoUrl(p)} alt="" className="w-20 h-20 object-cover rounded border" />
                  </a>
                ))}
                <label className="w-20 h-20 border-2 border-dashed rounded flex items-center justify-center text-xs text-gray-400 cursor-pointer hover:border-indigo-400 hover:text-indigo-500 text-center">
                  {busyId === item.id ? "Uploading..." : "+ Add Photos"}
                  <input
                    type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => handlePhotos(item, e.target.files)}
                  />
                </label>
              </div>

              <textarea
                defaultValue={item.listing_draft}
                rows={5}
                onBlur={(e) => {
                  if (e.target.value !== item.listing_draft) {
                    saveField(item, { listing_draft: e.target.value });
                  }
                }}
                className="w-full border rounded p-2 text-sm mt-3 font-mono"
              />
              <div className="flex items-center justify-end gap-2 mt-2 flex-wrap">
                {item.reverb_url ? (
                  <a
                    href={item.reverb_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-orange-100 text-orange-800 text-sm rounded hover:bg-orange-200"
                  >
                    Reverb draft ✓ open &amp; publish
                  </a>
                ) : (
                  <button
                    onClick={async () => {
                      if (item.photos.length === 0 && !confirm("No photos yet — list on Reverb without photos?")) return;
                      if (item.listing_draft.includes("[Describe") && !confirm("The draft still has the [Describe condition] placeholder — send anyway?")) return;
                      try {
                        await queueListOnReverb(item);
                        alert("Sent! The studio Mac will create the Reverb draft within a minute — a 'Reverb draft' link will appear here (tap Refresh).");
                      } catch {
                        alert("Couldn't queue it. Check your connection and try again.");
                      }
                    }}
                    className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded hover:bg-orange-600"
                  >
                    List on Reverb
                  </button>
                )}
                <button
                  onClick={async () => {
                    const ok = await copyText(item.listing_draft);
                    alert(ok ? "Listing copied. Paste it into eBay or Reverb." : "Couldn't copy, select the text manually.");
                  }}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
                >
                  Copy Listing Text
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
