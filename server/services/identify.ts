import Anthropic from "@anthropic-ai/sdk";
import { getEbayAppToken } from "../scrapers/ebay.js";
import { estimateValue } from "./valuation.js";

// Photo-first item identification: the phone uploads photos and the Mac works
// out what the item is. eBay's image search runs first (free, uses the app
// token we already have); when its matches don't agree, Claude looks at the
// photos (needs ANTHROPIC_API_KEY in .env — costs about a penny per item).

// ===== Identification tunables =====
const EBAY_IMAGE_RESULTS = 8; // matches to fetch from eBay's image search
const CONSENSUS_MIN_OVERLAP = 0.45; // how much the top matches must agree to trust them
const CLAUDE_MODEL = "claude-opus-5-5";
const CLAUDE_MAX_PHOTOS = 3; // photos sent to Claude (first ones)
const CLAUDE_MAX_TOKENS = 8000; // thinking spends from this budget too — don't starve it
const VALUATION_TIME_CAP_MS = 25_000; // a cold valuation scrape must not eat the phone's wait

export interface IdentifyRequest {
  probeUrls: string[]; // small downscaled JPEGs — eBay search + Claude both use these
  photoUrls: string[]; // full photos (fallback when no probes exist)
}

export interface IdentifyResult {
  ok: boolean;
  title?: string;
  source?: "ebay_image_match" | "claude";
  candidates?: string[];
  description?: string;
  condition_notes?: string;
  questions?: string[];
  suggested_target?: number;
  error?: string;
}

const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1);

// eBay's image search surfaces accessories FOR an item (their photos show the
// host item) — a "Case for Bose 301" must never win and price the speakers at
// case money. Exported for tests.
export function isLikelyAccessory(title: string): boolean {
  return (
    /\b(for|fits|compatible with)\b/i.test(title) &&
    /\b(case|cover|stand|mount|bracket|grille?|replacement|foam|surround|cable|adapter|remote|manual|knob|bag|skin|parts|kit|pads?|ears)\b/i.test(title)
  );
}

// Do eBay's top image matches agree on what this is? Dedupe near-identical
// titles (one seller's relisting flood must not vote many times), exclude
// accessory listings from winning, and score overlap SYMMETRICALLY so a short
// generic subset title ("Bose 301") can't beat the detailed ones.
// Exported for tests.
export function titleConsensus(titles: string[]): {
  title: string;
  confident: boolean;
} {
  const seen = new Set<string>();
  const deduped = titles.filter((t) => {
    const key = tokenize(t).join(" ");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const top = deduped.slice(0, 5).filter((t) => t.trim().length > 3);
  const eligible = top.filter((t) => !isLikelyAccessory(t));
  if (eligible.length === 0) return { title: "", confident: false };
  if (eligible.length === 1) return { title: eligible[0], confident: false };

  const tokenSets = eligible.map((t) => new Set(tokenize(t)));
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < eligible.length; i++) {
    let score = 0;
    for (let j = 0; j < eligible.length; j++) {
      if (i === j) continue;
      const overlapCount = [...tokenSets[i]].filter((t) => tokenSets[j].has(t)).length;
      score += overlapCount / Math.max(tokenSets[i].size, tokenSets[j].size, 1);
    }
    score /= eligible.length - 1;
    // Among similar scores, prefer the more detailed title
    if (score > bestScore + 0.01 || (Math.abs(score - bestScore) <= 0.01 && tokenSets[i].size > tokenSets[bestIdx].size)) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return { title: eligible[bestIdx], confident: bestScore >= CONSENSUS_MIN_OVERLAP };
}

// Walk the text and pull out balanced {...} spans — prose with stray braces
// around the JSON ("Looking at this {hard to tell} ... {\"title\": ...}") must
// not discard a paid, valid reply.
function extractJsonObjects(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length && out.length < 5; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = inStr; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

// Pull the JSON object out of Claude's reply (it may wrap it in a code fence
// or prose). Exported for tests.
export function parseIdentityJson(text: string): {
  title: string;
  description?: string;
  condition_notes?: string;
  questions?: string[];
} | null {
  for (const span of extractJsonObjects(text)) {
    try {
      const data = JSON.parse(span);
      if (typeof data?.title !== "string" || !data.title.trim()) continue;
      return {
        title: [...data.title.trim()].slice(0, 80).join(""),
        description: typeof data.description === "string" ? data.description : undefined,
        condition_notes:
          typeof data.condition_notes === "string" ? data.condition_notes : undefined,
        questions: Array.isArray(data.questions)
          ? data.questions.filter((q: unknown): q is string => typeof q === "string" && !!q).slice(0, 3)
          : [],
      };
    } catch {
      // not valid JSON — try the next balanced span
    }
  }
  return null;
}

async function searchEbayByImage(imageBase64: string): Promise<string[]> {
  const token = await getEbayAppToken();
  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search_by_image?limit=${EBAY_IMAGE_RESULTS}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      body: JSON.stringify({ image: imageBase64 }),
    }
  );
  if (!res.ok) throw new Error(`eBay image search ${res.status}`);
  const data = await res.json();
  return (data?.itemSummaries || [])
    .map((i: any) => String(i?.title || ""))
    .filter(Boolean);
}

async function claudeIdentify(
  photoUrls: string[],
  hints: string[]
): Promise<ReturnType<typeof parseIdentityJson>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const hintText = hints.length
    ? `eBay's image match suggests these titles:\n${hints.slice(0, 5).join("\n")}\nUse them as hints only — trust what you actually see in the photos.\n`
    : "";

  const content: Anthropic.ContentBlockParam[] = [
    ...photoUrls.slice(0, CLAUDE_MAX_PHOTOS).map(
      (url): Anthropic.ContentBlockParam => ({
        type: "image",
        source: { type: "url", url },
      })
    ),
    {
      type: "text",
      text:
        `Identify this secondhand item from the photos for a reseller's listing. Read any visible labels, logos, or model numbers.\n${hintText}` +
        `Reply with ONLY a JSON object, no other text:\n` +
        `{"title": "sellable title, brand first, under 70 characters", ` +
        `"condition_notes": "what the photos show about condition", ` +
        `"description": "2-4 plain honest sentences for the listing; no price, no exclamation marks, no em dashes, no emojis", ` +
        `"questions": ["up to 3 short questions about what the photos cannot show, like whether it powers on or what is included"]}`,
    },
  ];

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    output_config: { effort: "low" }, // simple extraction — bound thinking time and cost
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason !== "end_turn") {
    throw new Error(`Claude's reply was cut off (${response.stop_reason}) — try again.`);
  }
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return parseIdentityJson(text);
}

// Turn SDK errors into something the phone can show a non-technical owner
function friendlyClaudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The Claude key on the Mac looks wrong — check ANTHROPIC_API_KEY in the .env file.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Claude is busy right now — tap Identify again in a minute.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude couldn't look at the photos (${err.message.slice(0, 120)}).`;
  }
  return err instanceof Error ? err.message.slice(0, 150) : "unknown error";
}

export async function identifyItem(req: IdentifyRequest): Promise<IdentifyResult> {
  const probes = (req.probeUrls || []).filter(Boolean);
  if (probes.length === 0 && req.photoUrls.length === 0) {
    return { ok: false, error: "No photos to identify from." };
  }

  // Stage 1: eBay image search (free)
  let candidates: string[] = [];
  try {
    const probe = probes[0] || req.photoUrls[0];
    const imgRes = await fetch(probe);
    if (!imgRes.ok) throw new Error(`photo fetch ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > 4_000_000) throw new Error("photo too large for image search");
    candidates = await searchEbayByImage(buf.toString("base64"));
  } catch (err) {
    console.warn("eBay image search failed:", err instanceof Error ? err.message : err);
  }

  const consensus = titleConsensus(candidates);
  let title = consensus.confident ? consensus.title : "";
  let source: IdentifyResult["source"] = consensus.confident ? "ebay_image_match" : undefined;
  let description: string | undefined;
  let conditionNotes: string | undefined;
  let questions: string[] = [];
  let claudeError = "";

  // Stage 2: Claude looks at the photos when eBay couldn't tell.
  // Send the downscaled probes — full-res originals can be HEIC or over the
  // API's per-image size cap, and the small JPEGs read just as well.
  if (!title) {
    try {
      const claudePhotos = probes.length > 0 ? probes : req.photoUrls;
      const claude = await claudeIdentify(claudePhotos, candidates);
      if (claude) {
        title = claude.title;
        source = "claude";
        description = claude.description;
        conditionNotes = claude.condition_notes;
        questions = claude.questions || [];
      }
    } catch (err) {
      claudeError = friendlyClaudeError(err);
      console.warn("Claude identify failed:", claudeError);
    }
  }

  if (!title) {
    return {
      ok: false,
      candidates: candidates.slice(0, 5),
      error: !process.env.ANTHROPIC_API_KEY
        ? "eBay's matches didn't agree, and no ANTHROPIC_API_KEY is set for the smarter check — type the title, or set up the key."
        : claudeError || "Couldn't identify the item from the photos — type the title yourself.",
    };
  }

  // Value it against sold prices for a suggested target — but a cold lookup
  // can trigger a slow live scrape, and the phone is waiting. Cap it; if it's
  // slow, it finishes in the background and warms the cache for next time.
  let suggestedTarget: number | undefined;
  try {
    const valuation = estimateValue(title);
    valuation.catch(() => {});
    const result = await Promise.race([
      valuation.then((v) => v.result),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), VALUATION_TIME_CAP_MS)),
    ]);
    if (result?.estimatedValue) suggestedTarget = Math.round(result.estimatedValue);
  } catch {
    // no valuation — the owner can set the target by hand
  }

  return {
    ok: true,
    title,
    source,
    candidates: candidates.slice(0, 5),
    description,
    condition_notes: conditionNotes,
    questions,
    suggested_target: suggestedTarget,
  };
}
