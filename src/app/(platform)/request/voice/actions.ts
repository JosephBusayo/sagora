"use server";

import { parseAudio, processVoiceNote } from "@/lib/voice-intake";
import { signedInFarmer } from "@/lib/session";

export type VoiceState =
  | { ok: true; transcript: string; initial: Record<string, string>; missing: string[] }
  | { ok: false; reason: string }
  | Record<string, never>;

/**
 * Transcribes and extracts, then hands back BookForm-shaped values plus a plain list of what a
 * human still needs to fill in. Never creates a request — the caller pre-fills BookForm with
 * `initial`, which the farmer reviews and submits exactly as they would without voice at all.
 */
export async function transcribeVoiceNoteAction(_prev: VoiceState, fd: FormData): Promise<VoiceState> {
  const audio = parseAudio(String(fd.get("audio") ?? ""));
  if (!audio) return { ok: false, reason: "That recording could not be used. Please try again, or fill in the form instead." };

  const farmer = await signedInFarmer();
  const result = await processVoiceNote(audio, { kind: farmer ? "farmer" : "guest", id: farmer?.id ?? null });
  if (!result.ok) return result;

  const e = result.extracted;
  const initial: Record<string, string> = {};
  if (e.service) initial.service = e.service;
  if (e.acres != null) {
    initial.acres = String(e.acres);
    initial.unit = "acres"; // Gemini is asked to convert hectares to acres already.
  }
  if (e.district) initial.district = e.district;
  if (e.village) initial.village = e.village;
  if (e.preferredDate) initial.preferredDate = e.preferredDate;
  if (e.contactName) initial.contactName = e.contactName;
  if (e.contactPhone) initial.contactPhone = e.contactPhone;

  const missing: string[] = [];
  if (!e.service) missing.push("What work you need");
  if (e.acres == null) missing.push("Land size");
  if (!e.district) missing.push("District");
  if (!e.village) missing.push("Village or town");
  if (!e.preferredDate) missing.push("Preferred start date");
  if (!farmer) {
    if (!e.contactName) missing.push("Your name");
    if (!e.contactPhone) missing.push("Your phone number");
  }

  return { ok: true, transcript: result.transcript, initial, missing };
}
