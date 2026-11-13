import "server-only";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION, LAND_TYPE, CROP_READINESS } from "./land";
import { chiefdomsOf } from "./chiefdoms";

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

/** The model this was built and tested against. An AI_MODEL that Gemini rejects falls back to it
 * rather than taking the whole feature down: a mistyped variable should not stop a farmer. */
const DEFAULT_MODEL = "gemini-2.5-flash";
const model = () => process.env.AI_MODEL?.trim() || DEFAULT_MODEL;

/**
 * How long to wait for Gemini. Left to itself it can sit on an audio clip for minutes — long
 * enough that Vercel killed the whole request at its own 300-second limit and the farmer got
 * nothing but a crash page. This is the limit the farmer actually feels, so it is short.
 */
const TIMEOUT_MS = 45_000;

/** Where to call. Overridden only so the browser tests can stand in for Gemini, exactly as
 * MONIME_API_URL lets them stand in for Monime. Unset everywhere else, including production. */
const baseUrl = () => process.env.GEMINI_API_URL?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";

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

/** Gemini did not answer in time. Told apart from the rest so the farmer can be told to retry. */
export class GeminiTimeout extends Error {
  constructor() {
    super(`Gemini did not answer within ${TIMEOUT_MS / 1000}s`);
  }
}

const SERVICES = ["ploughing", "harvesting", "planting"] as const;

/** The option ids as the prompt lists them, so the form's own wording is the only wording. */
const ids = (options: readonly { id: string }[]) => JSON.stringify(options.map((o) => o.id));

/** The fields BookForm's first two steps can use. Anything not heard stays null — never guessed. */
export type ExtractedFields = {
  service: "ploughing" | "harvesting" | "planting" | null;
  acres: number | null;
  /** What is grown, for harvesting and planting — the form will not go on without it. */
  crop: string | null;
  district: string | null;
  /** Only kept when it is really a chiefdom of the district named: farmers sometimes name a
   * neighbouring district as their chiefdom, and a wrong one fails the form's own check. */
  chiefdom: string | null;
  village: string | null;
  /** Resolved to a real date (YYYY-MM-DD) relative to when the note was recorded — "this Saturday"
   * becomes an actual date, not left as text, so it can go straight into BookForm's date field. */
  preferredDate: string | null;
  contactName: string | null;
  contactPhone: string | null;
  /** The land and crop questions, as the form's own ids. Only filled when the farmer actually
   * said something that answers them — an unasked question is left for them to answer. */
  landAccess: string | null;
  landCondition: string | null;
  landClearance: string | null;
  landType: string | null;
  cropReadiness: string | null;
  /** Whatever else they said that matters and no field above holds — how to reach them, what
   * they are unsure about. Without this it was simply lost between the recording and the form. */
  notes: string | null;
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
    "null), crop (what is grown or to be planted, as a plain lowercase name such as \"rice\" or " +
    "\"cassava\", or null if they named none), " +
    `district (exactly one of ${JSON.stringify(DISTRICTS)}, matching the closest place ` +
    "they named, or null if you cannot tell), chiefdom (the chiefdom they named, spelled as a " +
    "chiefdom of that district, or null), village or town (or null), " +
    "preferredDate (if they give a specific, " +
    "relative, or vague date or time period — \"this Saturday\", \"second week of October\", " +
    "\"next month\" — resolve it to your single best-guess real calendar date in YYYY-MM-DD " +
    "format, relative to today's date given above. It must be on or after today's date: if the " +
    "period they named has already gone by this year, they mean the next time it comes round, so " +
    "use next year. Null only if they gave no date at all), " +
    "contactName (or null), contactPhone (digits only, or null — people often say \"I'll send my " +
    "number\" without actually speaking digits; only fill this if real digits were spoken), " +
    // The land questions are only filled from something actually said: a guess here is worse
    // than a blank, because the farmer sees an answered question and never corrects it.
    `landAccess (one of ${ids(LAND_ACCESS)}, or null), ` +
    `landCondition (one of ${ids(LAND_CONDITION)}, or null), ` +
    `landClearance (one of ${ids(LAND_CLEARANCE)}, or null), ` +
    `landType (one of ${ids(LAND_TYPE)}, or null), ` +
    `cropReadiness (one of ${ids(CROP_READINESS)}, or null) ` +
    "— each of these five only if they actually said something that answers it, otherwise null, " +
    "never a guess. Finally notes: anything else they said that someone arranging this work would " +
    "need to know and no field above holds — how to reach them, what they are unsure about — in " +
    "one or two plain English sentences, or null if there is nothing left over. " +
    "Reply with JSON only, shaped exactly as " +
    '{ "transcript": string, "extracted": { "service": ..., "acres": ..., "crop": ..., ' +
    '"district": ..., "chiefdom": ..., "village": ..., "preferredDate": ..., "contactName": ..., ' +
    '"contactPhone": ..., "landAccess": ..., "landCondition": ..., "landClearance": ..., ' +
    '"landType": ..., "cropReadiness": ..., "notes": ... } }, no commentary.';

  const contents = [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: audioBase64 } }] }];

  // First try: the configured model, answering in JSON, with thinking switched off — thinking is
  // what made this take minutes. Anything Gemini refuses outright is retried once on the model
  // this was tested against, asked plainly, which also covers an AI_MODEL that does not exist.
  const started = Date.now();
  let res = await send(key, model(), { contents, generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } } }, TIMEOUT_MS);
  if (!res.ok && model() !== DEFAULT_MODEL) {
    // Both tries share one budget, so a retry cannot push the request past the route's own limit.
    // A refused model answers in well under a second, so in practice the budget is barely touched.
    res = await send(key, DEFAULT_MODEL, { contents, generationConfig: { responseMimeType: "application/json" } }, Math.max(5_000, TIMEOUT_MS - (Date.now() - started)));
  }

  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message: string } };
  if (!res.ok) throw new GeminiError(res.status, json.error?.message ?? JSON.stringify(json).slice(0, 300));

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let parsed: { transcript?: string; extracted?: Partial<ExtractedFields> };
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|```$/g, "").trim()) as typeof parsed;
  } catch {
    throw new GeminiError(res.status, "Gemini did not return valid JSON");
  }
  return { transcript: String(parsed.transcript ?? ""), extracted: clean(parsed.extracted ?? {}) };
}

/** One attempt, abandoned after `ms` so a stalled call cannot hold the whole request open. */
async function send(key: string, name: string, body: unknown, ms: number): Promise<Response> {
  try {
    return await fetch(`${baseUrl()}/v1beta/models/${name}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) throw new GeminiTimeout();
    throw err;
  }
}

/**
 * Keeps only values the form can actually use. A service or district Gemini invented, or a date
 * in the wrong shape, becomes null — which the screen then asks the farmer for — rather than a
 * value that silently fails the form's own validation later on.
 */
function clean(e: Partial<ExtractedFields>): ExtractedFields {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  /** An option id, only if it is one the form actually offers. */
  const pick = (v: unknown, options: readonly { id: string }[]) => {
    const want = str(v)?.toLowerCase();
    return options.find((o) => o.id === want)?.id ?? null;
  };
  const district = DISTRICTS.find((d) => d.toLowerCase() === str(e.district)?.toLowerCase()) ?? null;
  const said = str(e.chiefdom)?.toLowerCase();
  const date = str(e.preferredDate);
  const today = new Date().toISOString().slice(0, 10);

  return {
    service: SERVICES.find((s) => s === str(e.service)?.toLowerCase()) ?? null,
    acres: typeof e.acres === "number" && Number.isFinite(e.acres) && e.acres > 0 ? e.acres : null,
    crop: str(e.crop)?.toLowerCase() ?? null,
    district,
    // Dropped unless it belongs to the district: "Bombali District, Karene Chiefdom" names a
    // neighbouring district, and the form would refuse it. Better asked than wrong.
    chiefdom: (district ? chiefdomsOf(district).find((c) => c.toLowerCase() === said) : null) ?? null,
    village: str(e.village),
    // A date already gone by is not something a farmer can be booked for, so it is asked for
    // again rather than carried into a form that would only reject it.
    preferredDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today ? date : null,
    contactName: str(e.contactName),
    contactPhone: str(e.contactPhone)?.replace(/[^\d]/g, "") || null,
    landAccess: pick(e.landAccess, LAND_ACCESS),
    landCondition: pick(e.landCondition, LAND_CONDITION),
    landClearance: pick(e.landClearance, LAND_CLEARANCE),
    landType: pick(e.landType, LAND_TYPE),
    cropReadiness: pick(e.cropReadiness, CROP_READINESS),
    notes: str(e.notes),
  };
}
