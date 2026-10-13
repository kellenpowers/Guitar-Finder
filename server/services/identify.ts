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

export interface IdentifyRequest {
  probeUrl: string; // small downscaled image for eBay's image search
  photoUrls: string[]; // full photos (Claude looks at these)
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

// Do eBay's top image matches agree on what this is? Pick the title that
// shares the most words with the others; confident when overlap is high.
// Exported for tests.
export function titleConsensus(titles: string[]): {
  title: string;
  confident: boolean;
} {
  const top = titles.slice(0, 5).filter((t) => t.trim().length > 3);
  if (top.length === 0) return { title: "", confident: false };
  if (top.length === 1) return { title: top[0], confident: false };

  const tokenSets = top.map((t) => new Set(tokenize(t)));
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < top.length; i++) {
    let score = 0;
    for (let j = 0; j < top.length; j++) {
      if (i === j) continue;
      const overlapCount = [...tokenSets[i]].filter((t) => tokenSets[j].has(t)).length;
      score += overlapCount / Math.max(1, tokenSets[i].size);
    }
    score /= top.length - 1;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return { title: top[bestIdx], confident: bestScore >= CONSENSUS_MIN_OVERLAP };
}

// Pull the JSON object out of Claude's reply (it may wrap it in a code fence).
// Exported for tests.
export function parseIdentityJson(text: string): {
  title: string;
  description?: string;
  condition_notes?: string;
  questions?: string[];
} | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    const title = String(data.title || "").trim();
    if (!title) return null;
    return {
      title: title.slice(0, 80),
      description: data.description ? String(data.description) : undefined,
      condition_notes: data.condition_notes ? String(data.condition_notes) : undefined,
      questions: Array.isArray(data.questions)
        ? data.questions.map((q: unknown) => String(q)).filter(Boolean).slice(0, 3)
        : [],
    };
  } catch {
    return null;
  }
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
    max_tokens: 2000,
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return parseIdentityJson(text);
}

export async function identifyItem(req: IdentifyRequest): Promise<IdentifyResult> {
  if (!req.probeUrl && req.photoUrls.length === 0) {
    return { ok: false, error: "No photos to identify from." };
  }

  // Stage 1: eBay image search (free)
  let candidates: string[] = [];
  try {
    const probe = req.probeUrl || req.photoUrls[0];
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

  // Stage 2: Claude looks at the photos when eBay couldn't tell
  if (!title) {
    try {
      const claude = await claudeIdentify(req.photoUrls, candidates);
      if (claude) {
        title = claude.title;
        source = "claude";
        description = claude.description;
        conditionNotes = claude.condition_notes;
        questions = claude.questions || [];
      }
    } catch (err) {
      console.warn("Claude identify failed:", err instanceof Error ? err.message : err);
    }
  }

  if (!title) {
    return {
      ok: false,
      candidates: candidates.slice(0, 5),
      error: process.env.ANTHROPIC_API_KEY
        ? "Couldn't identify the item from the photos — type the title yourself."
        : "eBay's matches didn't agree, and no ANTHROPIC_API_KEY is set for the smarter check — type the title, or set up the key.",
    };
  }

  // Value it against sold prices for a suggested target
  let suggestedTarget: number | undefined;
  try {
    const { result } = await estimateValue(title);
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
