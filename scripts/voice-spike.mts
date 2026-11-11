// Phase 0 of the voice-note feature (see the plan): proves Gemini can transcribe and extract
// fields from real Krio speech BEFORE any product code is written. Throwaway — delete once the
// pipeline is proven or abandoned. Not part of the app; never imported by anything under src/.
//
// This tests Option 1 from the cost comparison: Gemini's native audio input does transcription
// and field extraction in one call, with no separate speech-to-text model or hosting. It's the
// only option that costs nothing to set up and try — Gemini has a free API tier, and a Krio
// Whisper fine-tune (Option 2) has no free tier at all ("This model isn't deployed by any
// Inference Provider" on both evanmazor/whisper-large-krio and whisper-small-krio). Start here;
// only bother paying for a hosted Krio-specific model if these results come back too weak.
//
// Usage:
//   1. Drop a few short audio clips (webm/ogg/mp3/wav/m4a, one clear Krio speaker, little to no
//      background music) into data/voice-samples/, e.g. clip1.mp3.
//   2. Optionally add data/voice-samples/clip1.txt etc. with what was actually said, so the
//      script can print transcript vs. truth side by side. Skip it for clips with no known truth.
//   3. Set GOOGLE_GENERATIVE_AI_API_KEY in .env.local (free tier at aistudio.google.com is fine
//      for this spike). Optionally set AI_MODEL to try a different Gemini model.
//   4. Run:  npx tsx --env-file-if-exists=.env.local scripts/voice-spike.mts
//
// Read the output yourself. There is no pass/fail threshold here — judge whether the transcripts
// are usable for a real farmer's request, the way a human would.

import fs from "node:fs";
import path from "node:path";

const SAMPLES_DIR = path.join(process.cwd(), "data", "voice-samples");
const AUDIO_EXT = [".webm", ".ogg", ".mp3", ".wav", ".m4a"];
const MODEL = process.env.AI_MODEL?.trim() || "gemini-2.5-flash";

const geminiKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY)?.trim();
if (!geminiKey) {
  console.error("Set GOOGLE_GENERATIVE_AI_API_KEY first (free tier at aistudio.google.com is fine for this spike).");
  process.exit(1);
}

const mimeFor = (ext: string) =>
  ({ ".webm": "audio/webm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4" })[ext] ?? "application/octet-stream";

/**
 * One multimodal call: Gemini listens to the audio directly and returns both a plain transcript
 * and the structured fields in one response. This test prompt keeps the field list loose (not yet
 * constrained to lib/land.ts's exact option ids) so we can see what the model naturally hears —
 * the real extractor would tighten this once we know the transcripts are usable at all.
 */
async function transcribeAndExtract(file: string): Promise<{ transcript: string; extracted: unknown }> {
  const ext = path.extname(file).toLowerCase();
  const audioB64 = fs.readFileSync(file).toString("base64");
  const prompt =
    "This audio is a Sierra Leonean farmer describing, in Krio or English, work they need done on " +
    "their farm. First write out exactly what they said, in a \"transcript\" field, as faithfully as " +
    "you can even if some words are unclear. Then, in an \"extracted\" field, pull out: service " +
    "(ploughing, harvesting, planting, or unclear), acres (number or null), district (or null), " +
    "village (or null), when they want it done (or null), their name (or null), their phone number " +
    "(or null). Reply with JSON only, shaped as { \"transcript\": string, \"extracted\": {...} }, no commentary.";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mimeFor(ext), data: audioB64 } }] }],
      }),
    },
  );
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message: string } };
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`);

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
    return { transcript: parsed.transcript ?? "(no transcript field returned)", extracted: parsed.extracted ?? parsed };
  } catch {
    return { transcript: "(model did not return clean JSON — see raw below)", extracted: { raw: text } };
  }
}

async function main() {
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.error(`No ${SAMPLES_DIR} folder. Create it and drop a few short audio clips in.`);
    process.exit(1);
  }
  const files = fs.readdirSync(SAMPLES_DIR).filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase())).sort();
  if (files.length === 0) {
    console.error(`No audio files (${AUDIO_EXT.join(", ")}) found in ${SAMPLES_DIR}.`);
    process.exit(1);
  }

  for (const file of files) {
    const full = path.join(SAMPLES_DIR, file);
    const truthFile = full.replace(path.extname(file), ".txt");
    const truth = fs.existsSync(truthFile) ? fs.readFileSync(truthFile, "utf8").trim() : null;

    console.log(`\n${"=".repeat(60)}\n${file}\n${"=".repeat(60)}`);
    try {
      const { transcript, extracted } = await transcribeAndExtract(full);
      console.log("Transcript:", transcript);
      if (truth) console.log("What was actually said:", truth);
      console.log("Extracted:", JSON.stringify(extracted, null, 2));
    } catch (err) {
      console.error("FAILED:", err instanceof Error ? err.message : err);
    }
  }
}

await main();
