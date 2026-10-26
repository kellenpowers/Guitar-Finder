import { useEffect, useState } from "react";
import { getPasscode, setPasscode } from "../api";
import {
  listInventory, createItem, updateItem, deleteItem, uploadPhoto, photoUrl,
  generateListingDraft, syncAskingPrice, queueListOnReverb, queueImportReverb,
  queueListOnEbay, waitForCommand, downscaleImage, queueIdentifyItem, isReverbish,
  queueRevisePrice,
  type InventoryItem, type IdentifyResult,
} from "../lib/inventory";
import { marginFloorPrice } from "../lib/economics";
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
  const [newPhotos, setNewPhotos] = useState<string[]>([]);
  const [probePaths, setProbePaths] = useState<string[]>([]);
  const [newUploading, setNewUploading] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [idResult, setIdResult] = useState<IdentifyResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // Separate from busyId: "Pushing..." must only ever mean a price push is in
  // flight, not that a photo upload happens to share the busy flag
  const [pushingId, setPushingId] = useState<string | null>(null);
  // Which platforms to list on, per item. Defaults: eBay always, Reverb when
  // it's music gear (Reverb doesn't list cameras, consoles, furniture...).
  const [platformSel, setPlatformSel] = useState<Record<string, { ebay: boolean; reverb: boolean }>>({});
  const selFor = (item: InventoryItem) =>
    platformSel[item.id] ?? { ebay: true, reverb: isReverbish(item.title) };

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

  async function handleNewPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setNewUploading(true);
    try {
      const paths = [...newPhotos];
      const probes = [...probePaths];
      for (const file of Array.from(files)) {
        paths.push(await uploadPhoto(file));
        // Small JPEG copies of the first few photos — eBay's image search and
        // Claude both read these (originals can be HEIC or huge)
        if (probes.length < 3) {
          const probe = await downscaleImage(file).catch(() => null);
          if (probe) probes.push(await uploadPhoto(probe, "jpg"));
        }
      }
      setNewPhotos(paths);
      setProbePaths(probes);
    } catch {
      alert("A photo failed to upload. Try again.");
    }
    setNewUploading(false);
  }

  async function handleIdentify() {
    if (newPhotos.length === 0) return;
    setIdentifying(true);
    try {
      const cmdId = await queueIdentifyItem(probePaths, newPhotos);
      const outcome = await waitForCommand(cmdId, { timeoutMs: 240_000 });
      if (!outcome) {
        alert("The Mac hasn't answered yet — is it on and running Flip Finder? You can type the title yourself meanwhile.");
      } else {
        const r = (outcome.result || {}) as IdentifyResult;
        setIdResult(r);
        setAnswers({});
        if (r.title) {
          setNewTitle(r.title);
          if (r.suggested_target && !newTarget) setNewTarget(String(r.suggested_target));
        } else {
          alert(r.error || "Couldn't identify it — type the title yourself.");
        }
      }
    } catch (err) {
      alert(
        err instanceof Error && err.message.includes("unknown command")
          ? "Identify isn't switched on in the cloud yet — tell Claude to finish the cloud update. You can type the title yourself meanwhile."
          : "Couldn't reach the cloud. Check your connection."
      );
    }
    setIdentifying(false);
  }

  function buildNewDraft(title: string, target: number | null): string {
    const answered = (idResult?.questions || [])
      .map((q, i) => (answers[i] || "").trim())
      .filter(Boolean);
    if (!idResult?.description) {
      const base = generateListingDraft(title, target);
      return answered.length ? `${base}\n${answered.join("\n")}` : base;
    }
    const lines = [title, "", idResult.description];
    if (idResult.condition_notes) lines.push(idResult.condition_notes);
    lines.push(...answered);
    lines.push("Questions welcome.");
    return lines.join("\n");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    const target = newTarget ? Number(newTarget) : null;
    const item = await createItem({
      title,
      bought_price: newBought ? Number(newBought) : null,
      target_price: target,
      listing_draft: buildNewDraft(title, target),
    }).catch(() => null);
    if (!item) return alert("Couldn't add the item. Try again.");
    let withPhotos = item;
    if (newPhotos.length > 0) {
      const updated = await updateItem(item.id, { photos: newPhotos }).catch(() => null);
      if (updated) {
        withPhotos = updated;
      } else {
        alert("Item added, but attaching the photos failed — open it and add them again.");
      }
    }
    setItems((prev) => [withPhotos, ...(prev || [])]);
    setNewTitle(""); setNewBought(""); setNewTarget("");
    setNewPhotos([]); setProbePaths([]); setIdResult(null); setAnswers({});
    setShowAdd(false);
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

  // One tap lists on every toggled platform that isn't already live
  async function handleListIt(item: InventoryItem) {
    const sel = selFor(item);
    const toEbay = sel.ebay && !item.ebay_url;
    const toReverb = sel.reverb && !item.reverb_url;
    if (!toEbay && !toReverb) {
      return alert("Nothing to do — it's already live everywhere you've toggled on.");
    }
    if (toEbay && !item.target_price) return alert("Set a target price first — eBay needs one.");
    if (toEbay && item.photos.length === 0) {
      return alert("eBay requires at least one photo — add photos first.");
    }
    if (!toEbay && toReverb && item.photos.length === 0 && !confirm("No photos yet — list on Reverb without photos?")) {
      return;
    }
    if (item.listing_draft.includes("[Describe") && !confirm("The draft still has the [Describe condition] placeholder — continue anyway?")) {
      return;
    }
    const names = [
      toEbay && "eBay (goes LIVE, price auto-raised to cover its bigger fees)",
      toReverb && "Reverb (draft you review and publish)",
    ]
      .filter(Boolean)
      .join(" and ");
    if (!confirm(`List "${item.title}" on ${names}?`)) return;

    setBusyId(item.id);
    try {
      const jobs: Promise<{ platform: string; outcome: Awaited<ReturnType<typeof waitForCommand>> }>[] = [];
      if (toEbay) {
        jobs.push(queueListOnEbay(item).then((id) => waitForCommand(id).then((outcome) => ({ platform: "eBay", outcome }))));
      }
      if (toReverb) {
        jobs.push(queueListOnReverb(item).then((id) => waitForCommand(id).then((outcome) => ({ platform: "Reverb", outcome }))));
      }
      const results = await Promise.all(jobs);
      await load();
      alert(
        results
          .map(({ platform, outcome }) =>
            !outcome
              ? `${platform}: the Mac hasn't finished yet — is it on? Tap Refresh later.`
              : outcome.status === "done"
                ? `${platform}: done — the link is on the item.`
                : `${platform} failed: ${outcome.error}`
          )
          .join("\n\n")
      );
    } catch (err) {
      alert(
        err instanceof Error && err.message.includes("unknown command")
          ? "The cloud needs a small update for this — tell Claude."
          : "Couldn't queue it. Check your connection and try again."
      );
    }
    setBusyId(null);
  }

  // Push the CURRENT target price to every platform the item is live on. The
  // Mac fee-matches the eBay price and keeps multi-unit siblings in step.
  async function handlePushPrice(item: InventoryItem) {
    const price = item.target_price;
    if (!price || price <= 0) return alert("Set a target price first.");
    const where = [item.reverb_url && "Reverb", item.ebay_url && "eBay (fee-matched, a bit higher)"]
      .filter(Boolean)
      .join(" and ");
    if (!confirm(`Set "${item.title}" to $${Math.round(price)} on ${where}?`)) return;
    setBusyId(item.id);
    setPushingId(item.id);
    try {
      const id = await queueRevisePrice(item, price);
      const outcome = await waitForCommand(id);
      await load();
      if (!outcome) {
        alert("The Mac hasn't finished yet — is it on? The change applies when it wakes.");
      } else if (outcome.status === "done") {
        // Report what ACTUALLY changed (the Mac's result), not what the item's
        // links suggest should have changed
        const r = outcome.result || {};
        const parts = [
          r.reverb_applied > 0 && `Reverb $${Math.round(price)}`,
          r.ebay_price != null && `eBay $${r.ebay_price}`,
        ].filter(Boolean);
        const siblings = r.siblings
          ? ` Also updated ${r.siblings} matching unit${r.siblings > 1 ? "s" : ""}.`
          : "";
        alert(parts.length > 0 ? `Done — ${parts.join(", ")}.${siblings}` : "Done.");
      } else {
        alert(`Price change failed: ${outcome.error}`);
      }
    } catch (err) {
      alert(
        err instanceof Error && err.message.includes("unknown command")
          ? "The cloud needs a small update for this — tell Claude."
          : "Couldn't queue it. Check your connection and try again."
      );
    }
    setBusyId(null);
    setPushingId(null);
  }

  async function saveField(item: InventoryItem, fields: Partial<InventoryItem>) {
    // Optimistic: a same-gesture tap (edit the price, then tap List on eBay)
    // must see the new value instead of waiting out the network round-trip
    setItems((prev) => (prev || []).map((i) => (i.id === item.id ? { ...i, ...fields } : i)));
    const updated = await updateItem(item.id, fields).catch(() => null);
    if (updated) {
      setItems((prev) => (prev || []).map((i) => (i.id === item.id ? updated : i)));
    } else {
      alert("Couldn't save that change — check your connection and try again.");
      load();
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
            onClick={async () => {
              try {
                await queueImportReverb();
                alert("Import queued — the studio Mac pulls your live Reverb listings within a minute. Tap Refresh after.");
              } catch {
                alert("Couldn't queue the import. Check your connection.");
              }
            }}
            className="px-3 py-1.5 bg-orange-100 text-orange-800 text-sm rounded hover:bg-orange-200"
          >
            Import Reverb
          </button>
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
          <p className="text-sm text-gray-500">
            Add photos first — the app works out what it is and fills the fields.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {newPhotos.map((p) => (
              <img key={p} src={photoUrl(p)} alt="" className="w-16 h-16 object-cover rounded border" />
            ))}
            <label className="w-16 h-16 border-2 border-dashed rounded flex items-center justify-center text-xs text-gray-400 cursor-pointer hover:border-indigo-400 hover:text-indigo-500 text-center">
              {newUploading ? "..." : "+ Photos"}
              <input
                type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => handleNewPhotos(e.target.files)}
              />
            </label>
            <button
              type="button"
              onClick={handleIdentify}
              disabled={newPhotos.length === 0 || newUploading || identifying}
              className="px-3 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50"
            >
              {identifying ? "Identifying (takes a minute)..." : "Identify from photos"}
            </button>
          </div>
          {idResult?.candidates && idResult.candidates.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {idResult.candidates.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewTitle(c)}
                  className={`text-xs px-2 py-1 rounded border ${
                    newTitle === c ? "bg-indigo-600 text-white border-indigo-600" : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <input
            type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="What is it? e.g. Shure SM7B microphone" required
            className="w-full border rounded p-2 text-sm"
          />
          {(idResult?.questions || []).map((q, i) => (
            <input
              key={q}
              type="text"
              value={answers[i] || ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
              placeholder={`${q} (answer goes in the listing)`}
              className="w-full border rounded p-2 text-sm"
            />
          ))}
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
                  <p className="text-sm text-gray-500 flex items-center gap-1 flex-wrap">
                    {item.bought_price != null && <>Paid ${item.bought_price.toLocaleString()} · </>}
                    <span>Target $</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      key={`price-${item.id}-${item.target_price ?? ""}`}
                      defaultValue={item.target_price ?? ""}
                      placeholder="—"
                      onBlur={(e) => {
                        // iOS reports unparseable input as "" — don't let a typo
                        // silently clear the price
                        if (e.target.validity?.badInput) {
                          return alert("That price didn't read as a number — digits only, like 450.");
                        }
                        const v = e.target.value ? Number(e.target.value) : null;
                        if (v === (item.target_price ?? null)) return;
                        if (v != null && !(v > 0)) {
                          return alert("Enter a price above 0, or leave it blank.");
                        }
                        // An empty field wipes the price — only ever on purpose
                        // (iOS can report typed-but-unparseable input as empty)
                        if (v == null && !confirm("Remove the target price from this item?")) {
                          e.target.value = String(item.target_price ?? "");
                          return;
                        }
                        saveField(item, { target_price: v });
                      }}
                      className="w-20 border rounded px-1 py-0.5 text-sm text-gray-700"
                    />
                    <span>· Added {new Date(item.created_at).toLocaleDateString()}</span>
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

              {item.status === "listed" && (item.reverb_url || item.ebay_url) && (
                <div className="mt-2 flex items-center gap-x-3 gap-y-1.5 flex-wrap text-xs text-gray-600 bg-gray-50 border rounded px-2 py-1.5">
                  <span>
                    {item.views != null || item.watches != null
                      ? `👀 ${item.views ?? "–"} views · ${item.watches ?? "–"} watching`
                      : "Views and watchers show up after the next daily check."}
                  </span>
                  {item.bought_price != null && item.bought_price > 0 ? (
                    <span title="Lowest price that still clears your profit margin after fees. After 45 days unsold with no watchers, the autopilot may go below it — but never below breakeven on what you paid.">
                      Floor ${marginFloorPrice(item.bought_price, item.reverb_url ? "reverb" : "ebay")}
                    </span>
                  ) : (
                    <span className="text-amber-700">
                      No cost on file (bundle?) — estimated floor only. Add Paid $ for exact floors.
                    </span>
                  )}
                  <label
                    className="flex items-center gap-1 cursor-pointer"
                    title="Daily automatic markdowns. Holds your margin floor; after 45 days unsold it may go lower, but never below breakeven — a real loss is always your call."
                  >
                    <input
                      type="checkbox"
                      checked={item.auto_reprice !== false}
                      onChange={async (e) => {
                        const on = e.target.checked;
                        // Not saveField: if the cloud is out of date it silently
                        // drops this field, and a pause the owner believes in
                        // but that didn't stick would be the worst kind of lie
                        const updated = await updateItem(item.id, { auto_reprice: on }).catch(() => null);
                        if (updated && (updated.auto_reprice !== false) === on) {
                          setItems((prev) => (prev || []).map((i) => (i.id === item.id ? updated : i)));
                        } else {
                          load();
                          alert("Couldn't save the autopilot switch — the cloud needs a small update. Tell Claude.");
                        }
                      }}
                    />
                    Autopilot pricing
                  </label>
                  <button
                    onClick={() => handlePushPrice(item)}
                    disabled={busyId === item.id}
                    className="px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {pushingId === item.id ? "Pushing..." : "Push price to platforms"}
                  </button>
                </div>
              )}

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

              <input
                type="url"
                defaultValue={item.video_url || ""}
                placeholder="YouTube video link (unlisted) — attaches to the Reverb listing"
                onBlur={(e) => {
                  if (e.target.value !== (item.video_url || "")) {
                    saveField(item, { video_url: e.target.value || null });
                  }
                }}
                className="w-full border rounded p-2 text-sm mt-3"
              />
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
                {item.ebay_url ? (
                  <a
                    href={item.ebay_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-blue-100 text-blue-800 text-sm rounded hover:bg-blue-200"
                  >
                    eBay ✓ live
                  </a>
                ) : item.status === "sold" ? null : (
                  <label className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-700 border rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selFor(item).ebay}
                      onChange={(e) =>
                        setPlatformSel((prev) => ({
                          ...prev,
                          [item.id]: { ...selFor(item), ebay: e.target.checked },
                        }))
                      }
                    />
                    eBay
                  </label>
                )}
                {item.reverb_url ? (
                  <a
                    href={item.reverb_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-orange-100 text-orange-800 text-sm rounded hover:bg-orange-200"
                  >
                    Reverb ✓
                  </a>
                ) : item.status === "sold" ? null : (
                  <label className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-700 border rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selFor(item).reverb}
                      onChange={(e) =>
                        setPlatformSel((prev) => ({
                          ...prev,
                          [item.id]: { ...selFor(item), reverb: e.target.checked },
                        }))
                      }
                    />
                    Reverb
                  </label>
                )}
                {item.status !== "sold" && (!item.ebay_url || !item.reverb_url) && (
                  <button
                    onClick={() => handleListIt(item)}
                    disabled={busyId === item.id}
                    className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {busyId === item.id ? "Listing..." : "List It"}
                  </button>
                )}
                <button
                  onClick={async () => {
                    // Keep any "Asking $X" line in step with the current price
                    const ok = await copyText(syncAskingPrice(item.listing_draft, item.target_price ?? null));
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
