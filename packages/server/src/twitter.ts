/**
 * twitter.ts — X (Twitter) skill module
 * Semua operasi via Twitter internal API (no browser)
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARACTER_GUIDE_PATH = resolve(__dirname, "../data/knowledge/punakawan-characters.md");
const SESSION_PATH = resolve(__dirname, "../data/browser-sessions/twitter-punakawan.json");

const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// ─── AUTH ─────────────────────────────────────────────────────────────────────

function getCreds(): { authToken: string; ct0: string } {
  if (!existsSync(SESSION_PATH)) throw new Error("Session file not found");
  const cookies = JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as Array<{ name: string; value: string }>;
  const authToken = cookies.find((c) => c.name === "auth_token")?.value || "";
  const ct0 = cookies.find((c) => c.name === "ct0")?.value || "";
  if (!authToken || !ct0) throw new Error("auth_token or ct0 missing from session");
  return { authToken, ct0 };
}

async function xFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { authToken, ct0 } = getCreds();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${BEARER}`,
      "x-csrf-token": ct0,
      Cookie: `auth_token=${authToken}; ct0=${ct0}`,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      ...(init.headers as Record<string, string> || {}),
    },
  });
  return res.json();
}

// GraphQL POST helper
async function xGql(operationId: string, variables: object, features: object = {}): Promise<any> {
  return xFetch(`https://x.com/i/api/graphql/${operationId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variables, features }),
  });
}

// Extract tweet ID from URL
function tweetIdFromUrl(url: string): string | null {
  const m = url.match(/status\/(\d+)/);
  return m ? m[1] : null;
}

const GQL_FEATURES = {
  rweb_lists_timeline_redesign_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

// ─── TWEET ────────────────────────────────────────────────────────────────────

// Kirim tweet — otomatis pakai NoteTweet kalau > 280 char (X Premium)
export async function postTweet(text: string): Promise<{ ok: boolean; tweetId?: string; error?: string }> {
  if (text.length > 280) {
    return postNoteTweet(text);
  }
  try {
    const data = await xGql("SoVnbfCycZ7fERGCwpZkYA/CreateTweet", {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }, GQL_FEATURES);

    const tweetId = data?.data?.create_tweet?.tweet_results?.result?.rest_id;
    if (tweetId) return { ok: true, tweetId };
    const err = data?.errors?.[0]?.message || JSON.stringify(data).slice(0, 200);
    return { ok: false, error: err };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// NoteTweet — endpoint khusus X Premium untuk tweet > 280 char
async function postNoteTweet(
  text: string,
  replyToId?: string
): Promise<{ ok: boolean; tweetId?: string; error?: string }> {
  try {
    const variables: Record<string, any> = {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    };
    if (replyToId) {
      variables.reply = { in_reply_to_tweet_id: replyToId, exclude_reply_user_ids: [] };
    }

    const data = await xGql("HV0kxIGhYzc0eP8r2rha8A/CreateNoteTweet", variables, {
      ...GQL_FEATURES,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
    });

    const tweetId =
      data?.data?.notetweet_create?.tweet_results?.result?.rest_id ||
      data?.data?.create_tweet?.tweet_results?.result?.rest_id;
    if (tweetId) return { ok: true, tweetId };

    const err = data?.errors?.[0]?.message || JSON.stringify(data).slice(0, 300);
    return { ok: false, error: err };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── QUOTE TWEET ─────────────────────────────────────────────────────────────

// quoteTweetUrlOrId: bisa full URL atau tweet ID
export async function quoteTweet(
  quoteTweetUrlOrId: string,
  text: string
): Promise<{ ok: boolean; tweetId?: string; error?: string }> {
  const quotedId = /^\d+$/.test(quoteTweetUrlOrId)
    ? quoteTweetUrlOrId
    : tweetIdFromUrl(quoteTweetUrlOrId);
  if (!quotedId) return { ok: false, error: "Could not extract tweet ID" };

  const attachmentUrl = `https://twitter.com/i/status/${quotedId}`;

  // Pakai NoteTweet kalau text > 280 char (X Premium)
  if (text.length > 280) {
    return postQuoteNoteTweet(text, quotedId, attachmentUrl);
  }

  try {
    const data = await xGql("SoVnbfCycZ7fERGCwpZkYA/CreateTweet", {
      tweet_text: text,
      dark_request: false,
      attachment_url: attachmentUrl,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }, GQL_FEATURES);

    const tweetId = data?.data?.create_tweet?.tweet_results?.result?.rest_id;
    if (tweetId) return { ok: true, tweetId };
    const err = data?.errors?.[0]?.message || JSON.stringify(data).slice(0, 200);
    return { ok: false, error: err };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

async function postQuoteNoteTweet(
  text: string,
  quotedId: string,
  attachmentUrl: string
): Promise<{ ok: boolean; tweetId?: string; error?: string }> {
  try {
    const data = await xGql("HV0kxIGhYzc0eP8r2rha8A/CreateNoteTweet", {
      tweet_text: text,
      dark_request: false,
      attachment_url: attachmentUrl,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }, {
      ...GQL_FEATURES,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
    });

    const tweetId =
      data?.data?.notetweet_create?.tweet_results?.result?.rest_id ||
      data?.data?.create_tweet?.tweet_results?.result?.rest_id;
    if (tweetId) return { ok: true, tweetId };

    const err = data?.errors?.[0]?.message || JSON.stringify(data).slice(0, 300);
    return { ok: false, error: err };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── REPLY ────────────────────────────────────────────────────────────────────

// tweetUrlOrId: bisa berupa full URL atau tweet ID langsung
export async function replyToTweet(tweetUrlOrId: string, text: string): Promise<{ ok: boolean; tweetId?: string; error?: string }> {
  const replyToId = /^\d+$/.test(tweetUrlOrId) ? tweetUrlOrId : tweetIdFromUrl(tweetUrlOrId);
  if (!replyToId) return { ok: false, error: "Could not extract tweet ID" };

  // Pakai NoteTweet kalau reply panjang (X Premium)
  if (text.length > 280) {
    return postNoteTweet(text, replyToId);
  }

  try {
    const data = await xGql("SoVnbfCycZ7fERGCwpZkYA/CreateTweet", {
      tweet_text: text,
      dark_request: false,
      reply: { in_reply_to_tweet_id: replyToId, exclude_reply_user_ids: [] },
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }, GQL_FEATURES);

    const tweetId = data?.data?.create_tweet?.tweet_results?.result?.rest_id;
    if (tweetId) return { ok: true, tweetId };
    const err = data?.errors?.[0]?.message || JSON.stringify(data).slice(0, 200);
    return { ok: false, error: err };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── LIKE ─────────────────────────────────────────────────────────────────────

export async function likeTweet(tweetUrl: string): Promise<{ ok: boolean; error?: string }> {
  const tweetId = tweetIdFromUrl(tweetUrl);
  if (!tweetId) return { ok: false, error: "Could not extract tweet ID from URL" };

  try {
    const data = await xFetch("https://x.com/i/api/1.1/favorites/create.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `id=${tweetId}`,
    });
    if (data?.id_str || data?.id) return { ok: true };
    return { ok: false, error: data?.errors?.[0]?.message || "Like failed" };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── FOLLOW ───────────────────────────────────────────────────────────────────

export async function followUser(username: string): Promise<{ ok: boolean; error?: string }> {
  const screen_name = username.replace("@", "");
  try {
    const data = await xFetch("https://x.com/i/api/1.1/friendships/create.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `screen_name=${screen_name}&include_entities=false`,
    });
    if (data?.id_str || data?.screen_name) return { ok: true };
    return { ok: false, error: data?.errors?.[0]?.message || "Follow failed" };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── ANALYZE PROFILE ──────────────────────────────────────────────────────────

export async function analyzeProfile(username: string): Promise<{
  ok: boolean;
  data?: { name: string; bio: string; followers: number; following: number; tweets: number; joined: string; verified: boolean };
  error?: string;
}> {
  const screen_name = username.replace("@", "");
  try {
    const data = await xFetch(`https://x.com/i/api/1.1/users/show.json?screen_name=${screen_name}`);
    if (data?.id_str) {
      return {
        ok: true,
        data: {
          name: data.name,
          bio: data.description,
          followers: data.followers_count,
          following: data.friends_count,
          tweets: data.statuses_count,
          joined: data.created_at,
          verified: data.verified || data.is_blue_verified || false,
        },
      };
    }
    return { ok: false, error: data?.errors?.[0]?.message || "User not found" };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── GET FOLLOWING LIST ───────────────────────────────────────────────────────

export async function getFollowing(username: string, count = 100): Promise<{
  ok: boolean;
  users?: string[];
  error?: string;
}> {
  const screen_name = username.replace("@", "");
  // First get user ID
  try {
    const profile = await xFetch(`https://x.com/i/api/1.1/users/show.json?screen_name=${screen_name}`);
    if (!profile?.id_str) return { ok: false, error: "User not found" };

    const variables = JSON.stringify({ userId: profile.id_str, count, includePromotedContent: false });
    const features = JSON.stringify(GQL_FEATURES);
    const data = await xFetch(
      `https://x.com/i/api/graphql/iSicc7LrzWGBgDPL0tM_TQ/Following?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`
    );

    const users: string[] = [];
    const instructions = data?.data?.user?.result?.timeline?.timeline?.instructions || [];
    for (const inst of instructions) {
      for (const entry of inst.entries || []) {
        const sn = entry?.content?.itemContent?.user_results?.result?.legacy?.screen_name;
        if (sn) users.push(sn);
      }
    }
    return { ok: true, users };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── TIMELINE ─────────────────────────────────────────────────────────────────

export async function getTimeline(limit = 5): Promise<{
  ok: boolean;
  tweets?: Array<{ user: string; text: string; time: string }>;
  error?: string;
}> {
  try {
    const data = await xFetch(`https://x.com/i/api/1.1/statuses/home_timeline.json?count=${limit}&include_entities=false`);
    if (!Array.isArray(data)) return { ok: false, error: data?.errors?.[0]?.message || "Failed to fetch timeline" };
    const tweets = data.map((t: any) => ({
      user: t.user?.screen_name || "",
      text: t.full_text || t.text || "",
      time: t.created_at || "",
    }));
    return { ok: true, tweets };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── TRENDING INDONESIA ───────────────────────────────────────────────────────

// WOEID 23424846 = Indonesia
export async function getTrendingIndonesia(limit = 10): Promise<{
  ok: boolean;
  trends?: Array<{ name: string; tweetVolume: number | null }>;
  error?: string;
}> {
  try {
    const data = await xFetch("https://x.com/i/api/1.1/trends/place.json?id=23424846");
    if (!Array.isArray(data) || !data[0]?.trends) {
      return { ok: false, error: "Unexpected trends response" };
    }
    const trends = (data[0].trends as any[])
      .slice(0, limit)
      .map((t: any) => ({ name: t.name as string, tweetVolume: t.tweet_volume ?? null }));
    return { ok: true, trends };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── FIND TWEET TO REPLY ──────────────────────────────────────────────────────

// Cari tweet populer dari sebuah topik — kandidat untuk dibalas
export async function findTweetToReply(topic: string): Promise<{
  ok: boolean;
  tweet?: { id: string; user: string; text: string };
  error?: string;
}> {
  try {
    const data = await xFetch(
      `https://x.com/i/api/1.1/search/tweets.json?q=${encodeURIComponent(topic + " lang:id")}&result_type=popular&count=10&tweet_mode=extended&include_entities=false`
    );
    const statuses: any[] = data?.statuses || [];

    // Filter: ada text, bukan RT, minimal ada engagement
    const candidates = statuses.filter(
      (t) => (t.full_text || t.text) && !String(t.full_text || t.text).startsWith("RT ") && t.user?.screen_name
    );

    if (candidates.length === 0) {
      // Fallback ke recent
      const recent = await xFetch(
        `https://x.com/i/api/1.1/search/tweets.json?q=${encodeURIComponent(topic + " lang:id")}&result_type=recent&count=10&tweet_mode=extended&include_entities=false`
      );
      const recentStatuses: any[] = (recent?.statuses || []).filter(
        (t: any) => (t.full_text || t.text) && !String(t.full_text || t.text).startsWith("RT ")
      );
      if (recentStatuses.length === 0) return { ok: false, error: "No tweets found for topic" };
      const t = recentStatuses[0];
      return { ok: true, tweet: { id: t.id_str, user: t.user.screen_name, text: t.full_text || t.text } };
    }

    const t = candidates[0];
    return { ok: true, tweet: { id: t.id_str, user: t.user.screen_name, text: t.full_text || t.text } };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────

export async function searchTweets(query: string, limit = 5): Promise<{
  ok: boolean;
  tweets?: Array<{ user: string; text: string; time: string }>;
  error?: string;
}> {
  try {
    const data = await xFetch(
      `https://x.com/i/api/1.1/search/tweets.json?q=${encodeURIComponent(query)}&result_type=recent&count=${limit}&include_entities=false`
    );
    const statuses = data?.statuses;
    if (!Array.isArray(statuses)) return { ok: false, error: data?.errors?.[0]?.message || "Search failed" };
    const tweets = statuses.map((t: any) => ({
      user: t.user?.screen_name || "",
      text: t.full_text || t.text || "",
      time: t.created_at || "",
    }));
    return { ok: true, tweets };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── GENERATE TWEET (character-aware) ────────────────────────────────────────

const CHARACTERS = ["semar", "gareng", "petruk", "bagong"] as const;
type Character = (typeof CHARACTERS)[number];

const INTERACTION_GUIDE: Record<string, string> = {
  reply: `TARGET INTERAKSI: REPLY (bobot algoritma 27x lebih kuat dari like)
Tujuan: buat orang terdorong berkomentar.
Teknik WAJIB:
- Akhiri dengan pertanyaan terbuka yang personal: "Pernah ngerasain ini?", "Menurut lo gimana?", "Lo termasuk yang mana?"
- Atau buat pernyataan yang membagi pembaca jadi dua kubu — mereka yang setuju ingin bercerita, yang tidak setuju ingin meluruskan
- Validasi pengalaman universal — orang balas karena merasa "ini gue banget"
- Sisakan ruang kosong — jangan tutup semua kemungkinan, biarkan pembaca ingin menambahkan`,

  bookmark: `TARGET INTERAKSI: BOOKMARK (bobot algoritma 20x lebih kuat dari like)
Tujuan: buat orang menyimpan karena terlalu berharga untuk dilewatkan.
Teknik WAJIB:
- Format list atau poin bernomor — mudah disimpan sebagai referensi
- Insight spesifik dan actionable, bukan generik
- Data atau fakta mengejutkan yang bisa diverifikasi
- Terasa seperti "cheat code" atau shortcut menuju pemahaman yang biasanya butuh lama
- Orang harus merasa "nanti gue baca lagi" setelah baca ini`,

  retweet: `TARGET INTERAKSI: RETWEET (bobot algoritma 2x dari like)
Tujuan: buat orang ingin menyebarkan karena mewakili diri mereka.
Teknik WAJIB:
- Validasi identitas — pernyataan yang orang ingin orang lain tahu tentang diri mereka
- Membela sesuatu yang banyak orang percayai tapi jarang diungkapkan
- Terasa seperti "ini harus dibaca semua orang"
- Mudah dipahami tanpa konteks tambahan — bisa berdiri sendiri`,

  like: `TARGET INTERAKSI: LIKE
Tujuan: resonansi emosional singkat.
Teknik:
- Konten yang langsung terasa relatable
- Hangat, personal, sederhana
- Tidak perlu mengundang balasan — cukup membuat orang mengangguk`,
};

// ─── TOPIC POOL (per karakter) ────────────────────────────────────────────────

const TOPIC_POOL: Record<string, string[]> = {
  semar: [
    "kerja keras tapi gaji ga naik-naik",
    "anak muda yang capek tapi tetap jalan",
    "sabar bukan berarti diam, tapi tetap bergerak pelan",
    "kesenjangan antara yang kaya dan yang susah makin lebar",
    "ikhlas bukan berarti menyerah",
    "orang yang baik sering kali kalah di dunia, tapi tenang di hatinya",
    "hidup di kota besar dengan gaji UMR",
    "generasi sandwich yang nanggung orang tua sekaligus anak",
    "hutang budi yang tidak pernah bisa terbayar",
    "kebijaksanaan yang datang dari kegagalan, bukan kesuksesan",
  ],
  gareng: [
    "dilema antara ambisi dan kenyataan",
    "overthinking sebelum ambil keputusan kecil",
    "takut salah tapi kalau diam juga salah",
    "beli barang sale yang sebenernya ga butuh",
    "pengen produktif tapi malah rebahan",
    "nanya arah ke orang tapi tetap nyasar",
    "niat diet tapi kalah sama gorengan",
    "ragu-ragu pas mau bilang pendapat di rapat",
    "beli buku banyak tapi ga pernah dibaca",
    "terlambat ngerti sesuatu yang semua orang udah paham duluan",
  ],
  petruk: [
    "kebijakan pemerintah yang ga nyambung sama rakyat kecil",
    "buzzer dan opini publik yang dibeli",
    "koruptor yang hukumannya lebih ringan dari maling ayam",
    "pejabat yang bicara soal rakyat tapi ga pernah naik angkot",
    "infrastruktur mewah tapi tetangga masih banjir",
    "trending twitter yang dimanipulasi",
    "gaji DPR vs gaji guru",
    "artis yang tiba-tiba jadi calon kepala daerah",
    "subsidi yang ga nyampe ke yang berhak",
    "demokrasi yang tinggal di kertas saja",
  ],
  bagong: [
    "koruptor bebas, mahasiswa demo ditangkap",
    "harga BBM naik pas orang lagi susah",
    "influencer endorse produk bohong",
    "tilang manual vs tilang elektronik",
    "pns kerja sebentar, gaji penuh seumur hidup",
    "bangun rumah susah, bangun mall gampang",
    "orang miskin sakit, langsung bangkrut",
    "kerja 8 jam, lembur gratis",
    "standar ganda yang sudah biasa",
    "dibilang malas, tapi sistemnya memang tidak adil",
  ],
};

// Round-robin index per karakter (in-memory, reset saat restart)
const topicIndex: Record<string, number> = { semar: 0, gareng: 0, petruk: 0, bagong: 0 };

// Karakter yang dipilih secara bergilir
const charRotation = ["semar", "gareng", "petruk", "bagong"];
let charIndex = 0;

// Interaksi target yang bergilir
const interactionRotation = ["reply", "bookmark", "reply", "retweet"];
let interactionIndex = 0;

export function scheduledGenerate(): { character: string; topic: string; targetInteraction: string } {
  const character = charRotation[charIndex % charRotation.length];
  charIndex++;

  const topics = TOPIC_POOL[character];
  const idx = topicIndex[character] % topics.length;
  const topic = topics[idx];
  topicIndex[character]++;

  const targetInteraction = interactionRotation[interactionIndex % interactionRotation.length];
  interactionIndex++;

  return { character, topic, targetInteraction };
}

export async function generateTweet(
  character: string,
  topic: string,
  targetInteraction: string = "reply"
): Promise<{ ok: boolean; draft?: string; character?: string; error?: string }> {
  const char = character.toLowerCase() as Character;
  if (!CHARACTERS.includes(char)) {
    return { ok: false, error: `Karakter tidak valid. Pilih: ${CHARACTERS.join(", ")}` };
  }

  const guide = existsSync(CHARACTER_GUIDE_PATH) ? readFileSync(CHARACTER_GUIDE_PATH, "utf-8") : "";
  const charName = char.charAt(0).toUpperCase() + char.slice(1);
  const interactionGuide = INTERACTION_GUIDE[targetInteraction] || INTERACTION_GUIDE.reply;

  const prompt = `Kamu adalah ${charName} dari Punakawan.

Panduan karakter lengkap:
${guide}

${interactionGuide}

Buat satu tweet sebagai ${char} tentang topik: "${topic}"

ATURAN TEKNIS (wajib):
- Ikuti PERSIS gaya bicara, panjang, dan tone karakter ${char}
- Akhiri dengan -${charName}
- JANGAN taruh link eksternal apapun
- Gunakan line break — satu ide per baris, jangan wall of text
- Maksimal 1000 karakter total (akun ini X Premium, bisa lebih dari 280)
- Tulis langsung tweetnya saja, tanpa penjelasan atau komentar tambahan`;

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const output = execSync(`claude -p '${escaped}'`, { timeout: 30000, encoding: "utf-8" }).trim();
    return { ok: true, draft: output, character: char };
  } catch (err: any) {
    return { ok: false, error: err.message || "Generation failed" };
  }
}

// ─── GENERATE REPLY (character-aware, value-add) ──────────────────────────────

// Karakter yang cocok untuk reply strategy: lebih sering Bagong (blak-blakan) dan Petruk (satir)
const replyCharRotation = ["bagong", "petruk", "gareng", "bagong"];
let replyCharIndex = 0;

export async function generateReply(
  originalUser: string,
  originalText: string,
  character?: string
): Promise<{ ok: boolean; draft?: string; character?: string; error?: string }> {
  // Pilih karakter — kalau tidak dispesifikasi, gunakan rotasi
  const char = (character?.toLowerCase() ||
    replyCharRotation[replyCharIndex++ % replyCharRotation.length]) as Character;

  if (!CHARACTERS.includes(char)) {
    return { ok: false, error: `Karakter tidak valid: ${char}` };
  }

  const guide = existsSync(CHARACTER_GUIDE_PATH) ? readFileSync(CHARACTER_GUIDE_PATH, "utf-8") : "";
  const charName = char.charAt(0).toUpperCase() + char.slice(1);

  const prompt = `Kamu adalah ${charName} dari Punakawan — akun Twitter @PunakawanAI.

Panduan karakter lengkap:
${guide}

KONTEKS: Ada tweet dari @${originalUser}:
"${originalText}"

TUGAS: Tulis reply (balasan) ke tweet ini sebagai ${charName}.

ATURAN REPLY:
- Tambah value — kasih perspektif, insight, atau sudut pandang baru. BUKAN sekedar setuju/tidak setuju
- Pendek — reply bukan tempat ceramah. Maksimal 3-4 baris
- Jangan menyerang personal @${originalUser} — fokus pada isu/topik
- Mulai langsung tanpa "@${originalUser}" di awal
- Gunakan gaya bicara ${char} yang khas persis seperti di panduan
- Akhiri dengan -${charName}
- JANGAN taruh link apapun
- Maksimal 1000 karakter (akun X Premium)

Tulis langsung reply-nya saja, tanpa penjelasan.`;

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const output = execSync(`claude -p '${escaped}'`, { timeout: 30000, encoding: "utf-8" }).trim();
    return { ok: true, draft: output, character: char };
  } catch (err: any) {
    return { ok: false, error: err.message || "Reply generation failed" };
  }
}

// ─── REPLY STRATEGY: trending → find → generate ───────────────────────────────

export async function runReplyStrategy(count = 3): Promise<{
  ok: boolean;
  results?: Array<{
    trend: string;
    tweet?: { id: string; user: string; text: string };
    reply?: string;
    character?: string;
    error?: string;
  }>;
  error?: string;
}> {
  // 1. Ambil trending
  const trending = await getTrendingIndonesia(20);
  if (!trending.ok || !trending.trends?.length) {
    return { ok: false, error: trending.error || "No trends found" };
  }

  // Filter trending yang relevan (bukan tagar kosong, ada volume)
  const filtered = trending.trends
    .filter((t) => !t.name.startsWith("#") || (t.tweetVolume && t.tweetVolume > 1000))
    .slice(0, count * 2); // ambil lebih banyak kandidat

  const results = [];

  for (const trend of filtered) {
    if (results.length >= count) break;

    const found = await findTweetToReply(trend.name);
    if (!found.ok || !found.tweet) continue;

    const gen = await generateReply(found.tweet.user, found.tweet.text);
    if (!gen.ok || !gen.draft) continue;

    results.push({
      trend: trend.name,
      tweet: found.tweet,
      reply: gen.draft,
      character: gen.character,
    });
  }

  return { ok: true, results };
}

// ─── GENERATE THREAD ──────────────────────────────────────────────────────────

export async function generateThread(
  character: string,
  topic: string,
  tweetCount: number = 4
): Promise<{ ok: boolean; tweets?: string[]; character?: string; error?: string }> {
  const char = character.toLowerCase() as Character;
  if (!CHARACTERS.includes(char)) {
    return { ok: false, error: `Karakter tidak valid. Pilih: ${CHARACTERS.join(", ")}` };
  }

  const guide = existsSync(CHARACTER_GUIDE_PATH) ? readFileSync(CHARACTER_GUIDE_PATH, "utf-8") : "";
  const charName = char.charAt(0).toUpperCase() + char.slice(1);
  const n = Math.min(Math.max(tweetCount, 2), 6);

  const prompt = `Kamu adalah ${charName} dari Punakawan — akun Twitter @PunakawanAI.

Panduan karakter lengkap:
${guide}

TUGAS: Buat thread Twitter sebagai ${charName} tentang topik: "${topic}"

Thread terdiri dari ${n} tweet yang saling bersambung. Setiap tweet adalah satu bagian dari argumen/cerita yang mengalir.

STRUKTUR THREAD:
- Tweet 1: Hook kuat — kalimat pembuka yang langsung menarik perhatian. Harus buat orang mau lanjut baca.
- Tweet 2-${n - 1}: Isi — kembangkan topik, satu sudut pandang per tweet. Mengalir natural dari satu ke berikutnya.
- Tweet ${n}: Penutup — kesimpulan atau punchline yang membekas. Akhiri dengan "-${charName}".

ATURAN TEKNIS (wajib):
- Ikuti PERSIS gaya bicara dan tone ${char} — karakter harus terasa konsisten di semua tweet
- Setiap tweet maksimal 900 karakter (akun X Premium, sisakan ruang untuk numbering)
- JANGAN taruh link apapun
- Gunakan line break — satu ide per baris
- Tweet 1-${n - 1} TIDAK diakhiri "-${charName}" (hanya tweet terakhir)
- Antar tweet harus ada benang merah — satu narasi utuh

FORMAT OUTPUT (WAJIB PERSIS INI):
[1]
(isi tweet 1)

[2]
(isi tweet 2)

[3]
(isi tweet 3)

(dst sampai [${n}])

Tulis thread-nya langsung, tanpa penjelasan tambahan.`;

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const raw = execSync(`claude -p '${escaped}'`, { timeout: 45000, encoding: "utf-8" }).trim();

    // Parse output: ambil blok [N] ... [N+1]
    const tweets: string[] = [];
    const parts = raw.split(/\[(\d+)\]/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      // parts alternates: number, content, number, content...
      if (/^\d+$/.test(parts[i].trim())) continue;
      const content = parts[i].trim();
      if (content) tweets.push(content);
    }

    if (tweets.length < 2) {
      // Fallback: split by double newline
      const fallback = raw.split(/\n\n+/).filter((t) => t.trim().length > 10);
      if (fallback.length >= 2) return { ok: true, tweets: fallback.slice(0, n), character: char };
      return { ok: false, error: "Failed to parse thread output", character: char };
    }

    return { ok: true, tweets: tweets.slice(0, n), character: char };
  } catch (err: any) {
    return { ok: false, error: err.message || "Thread generation failed" };
  }
}
