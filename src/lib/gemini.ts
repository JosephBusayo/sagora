import "server-only";

/**
 * Voice-note request intake, phase 1-2 (see the plan). Gemini listens to the audio directly and
 * returns a transcript plus the structured fields BookForm needs, in one call — no separate
 * speech-to-text model or hosting, following Phase 0's result: Gemini's own Krio understanding,
 * tested on two real farmer voice notes, read as fluent and accurate enough to build on.
 *
 * Reads GOOGLE_GENERATIVE_AI_API_KEY (same variable name already used for the Phase 0 spike
 * script) and an optional AI_MODEL override. Both missing: the voice-note CTA simply does not
 * appear, the same way SAGORA_WHATSAPP's button does not.
 */

const apiKey = () => process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
const model = () => process.env.AI_MODEL?.trim() || "gemini-2.5-flash";

/** Sierra Leone's districts, exactly as BookForm's own list spells them (src/lib/business.ts),
 * so an extracted district matches the dropdown's value instead of needing a human to retype it. */
const DISTRICTS = [
  "Bo", "Bombali", "Bonthe", "Falaba", "Kailahun", "Kambia", "Karene", "Kenema",
  "Koinadugu", "Kono", "Moyamba", "Port Loko", "Pujehun", "Tonkolili",
  "Western Area Rural", "Western Area Urban",
];

export const geminiConfigured = (): boolean => Boolean(apiKey());

export class GeminiError extends Error {
  constructor(public status: number, message: string) {
    super(`Gemini ${status}: ${message}`);
  }
}

/** The fields BookForm's first two steps can use. Anything not heard stays null — never guessed. */
export type ExtractedFields = {
  service: "ploughing" | "harvesting" | "planting" | null;
  acres: number | null;
  district: string | null;
  village: string | null;
  /** Resolved to a real date (YYYY-MM-DD) relative to when the note was recorded — "this Saturday"
   * becomes an actual date, not left as text, so it can go straight into BookForm's date field. */
  preferredDate: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

const EMPTY: ExtractedFields = {
  service: null, acres: null, district: null, village: null, preferredDate: null, contactName: null, contactPhone: null,
};

export type Transcribed = { transcript: string; extracted: ExtractedFields };

/** One multimodal call: listens to the audio, returns a transcript and the fields above as JSON. */
export async function transcribeAndExtract(audioBase64: string, mime: string): Promise<Transcribed> {
  const key = apiKey();
  if (!key) throw new GeminiError(0, "GOOGLE_GENERATIVE_AI_API_KEY is not set");

  const today = new Date().toISOString().slice(0, 10);
  const prompt =
    `Today's date is ${today}. This audio is a Sierra Leonean farmer describing, in Krio or ` +
    "English, work they need done on their farm. Write exactly what they said in a \"transcript\" " +
    "field, as faithfully as you can even if some words are unclear. Then, in an \"extracted\" " +
    "field, pull out: service (exactly one of \"ploughing\", \"harvesting\", \"planting\", or null " +
    "if unclear), acres (a number — convert hectares to acres if that is what they said — or " +
    `null), district (exactly one of ${JSON.stringify(DISTRICTS)}, matching the closest place ` +
    "they named, or null if you cannot tell), village or town (or null), preferredDate (if they give a specific, " +
    "relative, or vague date or time period — \"this Saturday\", \"second week of October\", " +
    "\"next month\" — resolve it to your single best-guess real calendar date in YYYY-MM-DD " +
    "format, relative to today's date given above; null only if they gave no date at all), " +
    "contactName (or null), contactPhone (digits only, or null — people often say \"I'll send my " +
    "number\" without actually speaking digits; only fill this if real digits were spoken). " +
    "Reply with JSON only, shaped exactly as " +
    '{ "transcript": string, "extracted": { "service": ..., "acres": ..., "district": ..., ' +
    '"village": ..., "preferredDate": ..., "contactName": ..., "contactPhone": ... } }, no commentary.';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: audioBase64 } }] }],
      }),
    },
  );
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message: string } };
  if (!res.ok) throw new GeminiError(res.status, json.error?.message ?? JSON.stringify(json).slice(0, 300));

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text.replace(/^```json\s*|```$/g, "").trim()) as { transcript?: string; extracted?: Partial<ExtractedFields> };
    return { transcript: parsed.transcript ?? "", extracted: { ...EMPTY, ...parsed.extracted } };
  } catch {
    throw new GeminiError(res.status, "Gemini did not return valid JSON");
  }
}
