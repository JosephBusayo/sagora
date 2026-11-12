"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "@/components/app/Icon";
import { transcribeVoiceNoteAction, type VoiceState } from "@/app/(platform)/request/voice/actions";
import { BookForm } from "./BookForm";

type Option = { id: string; label: string };

/** What to say, in Krio and English, before recording. Matches Figma 152:107's prompt card. */
const SCRIPT = [
  { krio: "Wetin wok yu want?", en: "What work do you need? (ploughing, harvesting, planting)" },
  { krio: "Omos lan yu get?", en: "How much land? (acres or hectares)" },
  { krio: "Usai di lan de?", en: "Your district and village/town" },
  { krio: "Wen yu want di wok bigin?", en: "When do you want the work to start?" },
  { krio: "Wetin na yu nem, ɛn wetin na yu fon nɔmba?", en: "Your name and phone number" },
] as const;

const MAX_SECONDS = 90;
const BARS = [8, 24, 38, 24, 24, 18, 18, 18, 18, 18, 18, 8, 18, 34, 18, 12, 18];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Submitting() {
  const { pending } = useFormStatus();
  return pending ? <p className="notice" role="status">Listening to your recording and working out what you need…</p> : null;
}

/** Record live (tap the mic) or pick an existing voice note — many farmers' notes arrive as a file shared over WhatsApp. */
function Capture({ onReady }: { onReady: (dataUrl: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      {!recording ? (
        <div className="voice-capture__script">
          <p>Before you record, tell us:</p>
          <ul>
            {SCRIPT.map((s) => (
              <li key={s.en}><strong>{s.krio}</strong><span>{s.en}</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="voice-capture__mic-wrap">
        <button
          type="button"
          className={`voice-capture__mic${recording ? " voice-capture__mic--recording" : ""}`}
          onClick={() => (recording ? stopRecording() : void startRecording())}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          {recording ? (
            <>
              <span className="voice-capture__ring" aria-hidden="true" />
              <span className="voice-capture__ring" aria-hidden="true" />
              <span className="voice-capture__wave" aria-hidden="true">
                {BARS.map((h, i) => <span key={i} style={{ height: h, animationDelay: `${i * 0.06}s` }} />)}
              </span>
            </>
          ) : (
            <Icon name="microphone" size={48} />
          )}
        </button>
        {recording ? <p className="voice-capture__timer">{clock(seconds)}</p> : <p className="voice-capture__mic-hint">Tap the icon to record</p>}
      </div>

      <div className="voice-capture__actions">
        {recording ? (
          <button type="button" className="button button--soft" onClick={stopRecording}>End recording</button>
        ) : (
          <label className="voice-capture__upload">
            Or choose an existing voice note
            <input type="file" accept="audio/*" className="sr-only" onChange={(ev) => void choose(ev.target.files?.[0])} />
          </label>
        )}
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
  const [hideReview, setHideReview] = useState(false);
  const audioField = useRef<HTMLInputElement>(null);
  const showReview = "ok" in state && state.ok && !hideReview;

  // A recording (or a chosen file) sends itself — matches the design's record-then-review flow,
  // with no separate "Continue" click in between.
  function onReady(dataUrl: string) {
    setAudio(dataUrl);
    setHideReview(false);
    if (audioField.current) {
      audioField.current.value = dataUrl;
      audioField.current.form?.requestSubmit();
    }
  }

  if (showReview && "ok" in state && state.ok) {
    return (
      <>
        <div className="voice-review">
          <div className="voice-review__card">
            <h3>Your request</h3>
            <p>{state.transcript}</p>
          </div>
          {state.missing.length > 0 ? (
            <p className="voice-review__missing">We still need: {state.missing.join(", ")} — fill those in below.</p>
          ) : null}
          <div className="form-actions">
            <button type="button" className="button button--soft" onClick={() => setHideReview(true)}>Record again</button>
          </div>
        </div>
        <BookForm services={services} districts={districts} initial={state.initial} direct={direct} submissionKey={submissionKey} guest={guest} cancelHref={cancelHref} />
      </>
    );
  }

  return (
    <form action={action} className="form-soft">
      <input ref={audioField} type="hidden" name="audio" defaultValue={audio ?? ""} />
      <Capture onReady={onReady} />
      {"ok" in state && !state.ok ? <p className="notice notice--error" role="alert">{state.reason}</p> : null}
      <Submitting />
      <div className="form-actions">
        <a href={cancelHref} className="button button--soft">Cancel</a>
      </div>
    </form>
  );
}
