import express from "express";
import cors from "cors";
import searchesRouter from "./routes/searches.js";
import listingsRouter from "./routes/listings.js";
import pricingRouter from "./routes/pricing.js";
import { facebookScraper } from "./scrapers/facebook.js";
import { runSearch } from "./services/scheduler.js";
import { startScheduler } from "./services/scheduler.js";
import { getDb } from "./db/index.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
  })
);
app.use(express.json());

// API routes
app.use("/api/searches", searchesRouter);
app.use("/api/listings", listingsRouter);
app.use("/api/pricing", pricingRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Facebook login flow — opens a browser for manual login
app.post("/api/scrape/facebook/login", async (_req, res) => {
  try {
    await facebookScraper.login();
    res.json({ ok: true, message: "Logged in and cookies saved" });
  } catch (err) {
    console.error("Facebook login failed:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// Trigger a manual scrape for a specific search
app.post("/api/scrape/:searchId", async (req, res) => {
  try {
    const db = getDb();
    const search = db.prepare("SELECT * FROM saved_searches WHERE id = ?").get(req.params.searchId);
    if (!search) return res.status(404).json({ error: "Search not found" });

    const newCount = await runSearch(search);
    res.json({ ok: true, newListings: newCount });
  } catch (err) {
    console.error("Scrape failed:", err);
    res.status(500).json({ error: "Scrape failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Initialize DB on startup
  getDb();

  // Start the scheduler
  startScheduler();
});
