import { Router } from "express";
import { getDb } from "../db/index.js";

// User-adjustable defaults for new searches (e.g. default location)
const ALLOWED_KEYS = new Set([
  "default_location",
  "default_radius_miles",
  "default_max_price",
]);

const router = Router();

router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

router.put("/", (req, res) => {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!ALLOWED_KEYS.has(key)) continue;
    upsert.run(key, String(value ?? ""));
  }
  res.json({ ok: true });
});

export default router;
