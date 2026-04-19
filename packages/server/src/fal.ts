/**
 * fal.ai image generation client
 * Model: fal-ai/flux-pro — best for illustration & content trivia
 */

const FAL_API_BASE = "https://fal.run";
const DEFAULT_MODEL = "fal-ai/flux-pro";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ENHANCE_MODEL = "claude-haiku-4-5-20251001";

const ENHANCE_SYSTEM = `Kamu adalah prompt engineer untuk AI image generator (Flux Pro).
Diberikan deskripsi gambar dari user (bisa bahasa Indonesia atau Inggris):
- Jika cukup jelas (ada subjek + konteks yang cukup), buat versi enhanced dalam bahasa Inggris: tambah detail artistik, gaya visual, pencahayaan, komposisi, mood. Maksimal 120 kata.
- Jika terlalu vague (kurang dari 3 kata bermakna, atau hanya kata generik seperti "gambar bagus"), tanya SATU pertanyaan pendek dalam bahasa Indonesia untuk info paling krusial.
Balas HANYA dengan JSON valid satu baris, tanpa penjelasan:
{"action":"enhance","prompt":"..."} atau {"action":"clarify","question":"..."}`;

/**
 * Analyze an image using Claude vision and produce an image generation prompt.
 * Returns the crafted prompt string.
 */
export async function analyzeImageForPrompt(imageBase64: string, mimeType: string, userContext?: string): Promise<string> {
  const apiKey = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!apiKey) throw new Error("No API key available");

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ENHANCE_MODEL,
      max_tokens: 400,
      system: [{ type: "text", text: `Kamu adalah prompt engineer untuk AI image generator (Flux Pro).
Analisis gambar yang diberikan user secara detail: subjek utama, gaya visual/art style, warna dominan, pencahayaan, komposisi, mood, dan detail-detail penting lainnya.
Buat prompt image generation dalam bahasa Inggris yang mendeskripsikan apa yang ada di gambar dengan sangat detail dan vivid — sehingga AI bisa mereproduksi gambar serupa.
Balas HANYA dengan prompt text saja, tanpa penjelasan, tanpa kalimat pembuka.`, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 },
            },
            {
              type: "text",
              text: userContext
                ? `Analisis gambar ini dan buat image generation prompt yang detail. Konteks dari user: "${userContext}"`
                : "Analisis gambar ini dan buat image generation prompt yang detail.",
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Claude vision API ${res.status}: ${err}`);
  }

  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content?.[0]?.text?.trim() || "";
}

export type EnhanceResult =
  | { action: "enhance"; prompt: string }
  | { action: "clarify"; question: string };

/**
 * Call Claude Haiku to enhance an image prompt or ask for clarification.
 */
export async function enhanceOrClarify(rawPrompt: string): Promise<EnhanceResult> {
  const apiKey = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!apiKey) {
    // Fallback: just use the raw prompt if no API key
    return { action: "enhance", prompt: rawPrompt };
  }

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ENHANCE_MODEL,
        max_tokens: 300,
        system: [{ type: "text", text: ENHANCE_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: rawPrompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}`);

    const data = await res.json() as { content: Array<{ text: string }> };
    const text = data.content?.[0]?.text?.trim() || "";
    const parsed = JSON.parse(text) as EnhanceResult;
    if (parsed.action === "enhance" || parsed.action === "clarify") return parsed;
  } catch {
    // Fallback silently
  }

  return { action: "enhance", prompt: rawPrompt };
}

interface FalImageResult {
  url: string;
  width: number;
  height: number;
  content_type: string;
}

interface FalResponse {
  images: FalImageResult[];
  seed?: number;
  timings?: Record<string, number>;
}

export class FalClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Generate an image from a text prompt.
   * Returns the image URL, or throws on failure.
   */
  async generateImage(prompt: string, options?: {
    model?: string;
    imageSize?: "square" | "landscape_4_3" | "landscape_16_9" | "portrait_4_3" | "portrait_16_9";
    numInferenceSteps?: number;
    numImages?: number;
  }): Promise<string[]> {
    const model = options?.model || DEFAULT_MODEL;
    const url = `${FAL_API_BASE}/${model}`;
    const numImages = options?.numImages ?? 1;

    const body = {
      prompt,
      image_size: options?.imageSize || "square",
      num_inference_steps: options?.numInferenceSteps || 28,
      num_images: numImages,
      enable_safety_checker: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Key ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`fal.ai error ${res.status}: ${err}`);
    }

    const data = await res.json() as FalResponse;
    const urls = data.images?.map(i => i.url).filter(Boolean);
    if (!urls?.length) throw new Error("fal.ai: no image URL in response");

    return urls;
  }
}

/**
 * Detect if a message is an image generation request.
 * Returns the extracted prompt, or null if not a gen request.
 */
export function detectImageRequest(text: string): string | null {
  const patterns = [
    /^(?:tolong\s+)?(?:bikin|buat|buatkan|generate|gambarkan|ilustrasikan|coba\s+(?:bikin|buat))\s+(?:gambar|ilustrasi|image|foto)\s+(?:tentang\s+|dari\s+|soal\s+)?(.+)/i,
    /^(?:bikin|buat|buatkan|generate)\s+(.+?)\s+(?:gambar|ilustrasi|image)/i,
    /^(?:gambar|ilustrasi)\s+(?:tentang\s+|dari\s+|soal\s+)?(.+)/i,
    /^\/image\s+(.+)/i,
    /^\/gambar\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.trim().match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return null;
}
