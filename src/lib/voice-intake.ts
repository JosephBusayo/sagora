import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { GeminiTimeout, geminiConfigured, transcribeAndExtract, type ExtractedFields } from "./gemini";

/** The largest voice note accepted, as base64 text — about 2MB of actual audio, plenty for 90s of webm/opus. */
const AUDIO_MAX_CHARS = 2_800_000;

const ALLOWED_MIME = ["audio/webm", "audio/ogg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/mpeg", "audio/wav"];

/**
 * Checks a voice note sent as a data URL. The container formats vary too much (webm, ogg, mp4,
 * mp3, wav) to sniff every one the way parsePhoto sniffs JPEG/PNG/WebP, so this checks the claimed
 * type is one we actually handle and the size is sane, rather than inspecting every magic byte.
 */
export function parseAudio(dataUrl: string): { mime: string; data: string } | null {
  const m = dataUrl.match(/^data:(audio\/[a-z0-9.-]+);base64,([A-Za-z0-9+/]+=*)$/i);
  if (!m || m[2].length === 0 || m[2].length > AUDIO_MAX_CHARS) return null;
  const mime = m[1].toLowerCase();
  return ALLOWED_MIME.includes(mime) ? { mime, data: m[2] } : null;
}

export const voiceIntakeConfigured = geminiConfigured;

export type VoiceOutcome = { ok: true; transcript: string; extracted: ExtractedFields } | { ok: false; reason: string };

/**
 * The whole voice-note pipeline: transcribe and extract, then log the result either way. Never
 * creates a request itself — callers pre-fill BookForm/AssistedForm/PrivateJobForm with the
 * result, and the farmer (or staff, or provider) reviews and submits exactly as they do today.
 */
export async function processVoiceNote(
  audio: { mime: string; data: string },
  by: { kind: "farmer" | "guest" | "staff" | "provider"; id: string | null },
): Promise<VoiceOutcome> {
  const now = new Date().toISOString();
  try {
    const { transcript, extracted } = await transcribeAndExtract(audio.data, audio.mime);
    await log(`INSERT INTO voice_intake (id, created_by_kind, created_by_id, transcript, extracted_json, status, created_at) VALUES (?,?,?,?,?,'transcribed',?)`,
      [randomUUID(), by.kind, by.id, transcript, JSON.stringify(extracted), now]);
    return { ok: true, transcript, extracted };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 300);
    console.error("voice intake failed:", message);
    await log(`INSERT INTO voice_intake (id, created_by_kind, created_by_id, status, error, created_at) VALUES (?,?,?,'failed',?,?)`,
      [randomUUID(), by.kind, by.id, message, now]);
    return {
      ok: false,
      reason: err instanceof GeminiTimeout
        ? "That took too long to understand. Please try a shorter recording, or fill in the form instead."
        : "We could not understand that recording. Please try again, or fill in the form instead.",
    };
  }
}

/**
 * Writes the log row, and swallows anything that goes wrong doing so. This table exists to debug
 * bad transcriptions — it is not the product. An unapplied migration or a database hiccup used to
 * escape the catch block above and crash the screen, losing a transcript that had already worked.
 */
async function log(sql: string, args: (string | null)[]): Promise<void> {
  try {
    await db.run(sql, ...args);
  } catch (err) {
    console.error("voice_intake log failed:", err instanceof Error ? err.message : err);
  }
}
