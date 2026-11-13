"use server";

import { parseAudio, processVoiceNote } from "@/lib/voice-intake";
import { signedInFarmer } from "@/lib/session";
import { needsCrop } from "@/lib/land";
import { chiefdomsOf } from "@/lib/chiefdoms";

/** `sent` echoes back which recording this answers, so the screen can tell a result for the
 * recording it is waiting on from the leftover result of the one before it. */
export type VoiceState =
  | { ok: true; sent: number; transcript: string; initial: Record<string, string>; missing: string[] }
  | { ok: false; sent: number; reason: string }
  | Record<string, never>;

/**
 * Transcribes and extracts, then hands back BookForm-shaped values plus a plain list of what a
 * human still needs to fill in. Never creates a request — the caller pre-fills BookForm with
 * `initial`, which the farmer reviews and submits exactly as they would without voice at all.
 */
export async function transcribeVoiceNoteAction(_prev: VoiceState, fd: FormData): Promise<VoiceState> {
  const sent = Number(fd.get("sent") ?? 0) || 0;
  const audio = parseAudio(String(fd.get("audio") ?? ""));
  if (!audio) return { ok: false, sent, reason: "That recording could not be used. Please try again, or fill in the form instead." };

  const farmer = await signedInFarmer();
  const result = await processVoiceNote(audio, { kind: farmer ? "farmer" : "guest", id: farmer?.id ?? null });
  if (!result.ok) return { ...result, sent };

  const e = result.extracted;
  // Every field BookForm takes, under the name BookForm knows it by. A field left out here is a
  // field the farmer has to type again even though they already said it out loud.
  const initial: Record<string, string> = {};
  const put = (key: string, value: string | null) => { if (value) initial[key] = value; };
  put("service", e.service);
  if (e.acres != null) {
    initial.acres = String(e.acres);
    initial.unit = "acres"; // Gemini is asked to convert hectares to acres already.
  }
  put("crop", e.crop);
  put("district", e.district);
  put("chiefdom", e.chiefdom);
  put("village", e.village);
  put("preferredDate", e.preferredDate);
  put("contactName", e.contactName);
  put("contactPhone", e.contactPhone);
  put("landAccess", e.landAccess);
  put("landCondition", e.landCondition);
  put("landClearance", e.landClearance);
  put("landType", e.landType);
  put("cropReadiness", e.cropReadiness);
  put("notes", e.notes);

  const missing: string[] = [];
  if (!e.service) missing.push("What work you need");
  if (e.acres == null) missing.push("Land size");
  // Harvesting and planting will not go through without it, so it is asked for by name.
  if (e.service && needsCrop(e.service) && !e.crop) missing.push("Which crop");
  if (!e.district) missing.push("District");
  if (e.district && chiefdomsOf(e.district).length > 0 && !e.chiefdom) missing.push("Chiefdom");
  if (!e.village) missing.push("Village or town");
  if (!e.preferredDate) missing.push("Preferred start date");
  if (!e.landAccess) missing.push("Land access");
  if (!e.landClearance) missing.push("Land clearance");
  if (e.service === "harvesting" && !e.cropReadiness) missing.push("Whether the crop is ready");
  if (!farmer) {
    if (!e.contactName) missing.push("Your name");
    if (!e.contactPhone) missing.push("Your phone number");
  }

  return { ok: true, sent, transcript: result.transcript, initial, missing };
}
