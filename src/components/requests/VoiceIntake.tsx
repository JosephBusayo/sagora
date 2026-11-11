"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { transcribeVoiceNoteAction, type VoiceState } from "@/app/(platform)/request/voice/actions";
import { BookForm } from "./BookForm";

type Option = { id: string; label: string };

/** What to say, in Krio and English, before recording. No Figma frame exists for this screen. */
const SCRIPT = [
  { krio: "Wetin wok yu want?", en: "What work do you need? (ploughing, harvesting, planting)" },
  { krio: "Omos lan yu get?", en: "How much land? (acres or hectares)" },
  { krio: "Usai di lan de?", en: "Your district and village/town" },
  { krio: "Wen yu want di wok bigin?", en: "When do you want the work to start?" },
  { krio: "Wetin na yu nem, ɛn wetin na yu fon nɔmba?", en: "Your name and phone number" },
] as const;

const MAX_SECONDS = 90;

function Submitting() {
  const { pending } = useFormStatus();
  return pending ? <p className="notice" role="status">Listening to your recording and working out what you need…</p> : null;
}

/** Record live (MediaRecorder) or pick an existing voice note — many farmers' notes already exist as a file shared over WhatsApp. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Capture({ onReady }: { onReady: (dataUrl: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A visible, ticking clock while recording — nothing else on screen says "this is working".
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  async function startRecording() {
    setError("");
    setSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => chunksRef.current.push(ev.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          setPreview({ url: dataUrl, label: "Your recording" });
          onReady(dataUrl);
        };
        reader.readAsDataURL(blob);
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
      timerRef.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_SECONDS * 1000);
    } catch {
      setError("We could not reach your microphone. You can still pick an existing voice note below.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearTimeout(timerRef.current);
    mediaRef.current?.stop();
    setRecording(false);
  }

  async function choose(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError("Choose an audio file — a voice note works, for example one shared over WhatsApp.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      setPreview({ url: dataUrl, label: file.name });
      onReady(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="voice-capture">
      <div className="voice-capture__script">
        <p className="field__label">Before you record, tell us:</p>
        <ul>
          {SCRIPT.map((s) => (
            <li key={s.en}><strong>{s.krio}</strong> — {s.en}</li>
          ))}
        </ul>
      </div>

      {recording ? (
        <p className="voice-capture__recording" role="status">
          <span className="voice-capture__dot" aria-hidden="true" />
          Recording… {clock(seconds)}
        </p>
      ) : null}

      <div className="voice-capture__actions">
        {recording ? (
          <button type="button" className="button button--danger" onClick={stopRecording}>Stop and use this recording</button>
        ) : (
          <button type="button" className="button" onClick={() => void startRecording()}>Record a voice note</button>
        )}
        {!recording ? (
          <label className="button button--soft voice-capture__upload">
            Or choose an existing voice note
            <input type="file" accept="audio/*" className="sr-only" onChange={(ev) => void choose(ev.target.files?.[0])} />
          </label>
        ) : null}
      </div>

      {preview ? <p className="field__helper">{preview.label} is ready. <audio src={preview.url} controls /></p> : null}
      {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
    </div>
  );
}

export function VoiceIntake({ services, districts, direct, submissionKey, guest, cancelHref }: {
  services: readonly Option[]; districts: readonly string[];
  direct?: { id: string; name: string };
  submissionKey: string;
  guest: boolean;
  cancelHref: string;
}) {
  const [state, action] = useActionState<VoiceState, FormData>(transcribeVoiceNoteAction, {});
  const [audio, setAudio] = useState<string | null>(null);

  if ("ok" in state && state.ok) {
    return (
      <>
        <div className="voice-review">
          <details className="voice-review__transcript">
            <summary>What we heard</summary>
            <p>{state.transcript}</p>
          </details>
          {state.missing.length > 0 ? (
            <p className="notice" role="status">
              We got most of it from your recording. We still need: <strong>{state.missing.join(", ")}</strong> — fill those in below.
            </p>
          ) : (
            <p className="notice notice--success" role="status">We got everything from your recording. Check it over below before sending.</p>
          )}
        </div>
        <BookForm services={services} districts={districts} initial={state.initial} direct={direct} submissionKey={submissionKey} guest={guest} cancelHref={cancelHref} />
      </>
    );
  }

  return (
    <form action={action} className="form-soft">
      <input type="hidden" name="audio" value={audio ?? ""} />
      <Capture onReady={setAudio} />
      {"ok" in state && !state.ok ? <p className="notice notice--error" role="alert">{state.reason}</p> : null}
      <Submitting />
      <div className="form-actions">
        <a href={cancelHref} className="button button--soft">Cancel</a>
        <button type="submit" className="button" disabled={!audio}>Continue</button>
      </div>
    </form>
  );
}
