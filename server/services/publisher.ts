// Pushes the latest findings to the private cloud site after each sweep,
// so the phone app works away from home. Does nothing unless PUBLISH_URL
// and PUBLISH_KEY are set in .env.
let warnedDisabled = false;

export async function publishSnapshot(): Promise<void> {
  const url = process.env.PUBLISH_URL;
  const key = process.env.PUBLISH_KEY;
  if (!url || !key) {
    if (!warnedDisabled) {
      console.warn(
        "Cloud publishing DISABLED — PUBLISH_URL/PUBLISH_KEY not set in .env, so the phone site will not update."
      );
      warnedDisabled = true;
    }
    return;
  }

  try {
    const port = process.env.PORT || 3001;
    const res = await fetch(
      `http://localhost:${port}/api/listings?sortBy=flip&includeComps=1`
    );
    if (!res.ok) throw new Error(`listings fetch returned ${res.status}`);
    const listings = await res.json();

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-publish-key": key },
      body: JSON.stringify({ updatedAt: new Date().toISOString(), listings }),
    });
    if (!resp.ok) {
      console.error(`Cloud publish failed: ${resp.status} ${await resp.text()}`);
    } else {
      console.log(`Published ${listings.length} listings to the cloud site.`);
    }
  } catch (err) {
    console.error("Cloud publish failed:", err instanceof Error ? err.message : err);
  }
}
