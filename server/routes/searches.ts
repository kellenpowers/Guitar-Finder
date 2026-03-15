import { Router } from "express";
import { getDb } from "../db/index.js";

const router = Router();

router.get("/", (_req, res) => {
  const db = getDb();
  const searches = db.prepare("SELECT * FROM saved_searches ORDER BY updated_at DESC").all();
  res.json(searches);
});

router.get("/:id", (req, res) => {
  const db = getDb();
  const search = db.prepare("SELECT * FROM saved_searches WHERE id = ?").get(req.params.id);
  if (!search) return res.status(404).json({ error: "Not found" });
  res.json(search);
});

router.post("/", (req, res) => {
  const db = getDb();
  const { name, query, category, maxPrice, minDealScore, location, radiusMiles, cronSchedule } = req.body;
  const result = db.prepare(`
    INSERT INTO saved_searches (name, query, category, max_price, min_deal_score, location, radius_miles, cron_schedule)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, query, category || "", maxPrice || null, minDealScore || 0,
    location || "", radiusMiles || 25, cronSchedule || "*/30 * * * *"
  );
  const search = db.prepare("SELECT * FROM saved_searches WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(search);
});

router.put("/:id", (req, res) => {
  const db = getDb();
  const { name, query, category, maxPrice, minDealScore, location, radiusMiles, isActive, cronSchedule } = req.body;
  db.prepare(`
    UPDATE saved_searches
    SET name = ?, query = ?, category = ?, max_price = ?, min_deal_score = ?,
        location = ?, radius_miles = ?, is_active = ?, cron_schedule = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name, query, category || "", maxPrice || null, minDealScore || 0,
    location || "", radiusMiles || 25, isActive ? 1 : 0, cronSchedule || "*/30 * * * *",
    req.params.id
  );
  const search = db.prepare("SELECT * FROM saved_searches WHERE id = ?").get(req.params.id);
  if (!search) return res.status(404).json({ error: "Not found" });
  res.json(search);
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM saved_searches WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

export default router;
