"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { transcribeVoiceNoteAction, type VoiceState } from "@/app/(platform)/request/voice/actions";
import { BookForm } from "./BookForm";

type Option = { id: string; label: string };

/** What to say, in Krio and English, below the mic. The design's prompt card (152:244). */
const SCRIPT = [
  { krio: "Wetin wok yu want?", en: "What work do you need? (ploughing, harvesting, planting)" },
  { krio: "Omos lan yu get?", en: "How much land? (acres or hectares)" },
  { krio: "Usai di lan de?", en: "Your district and village/town" },
  { krio: "Wen yu want di wok bigin?", en: "When do you want the work to start?" },
  { krio: "Wetin na yu nem, ɛn wetin na yu fon nɔmba?", en: "Your name and phone number" },
] as const;

const MAX_SECONDS = 90;
/** The waveform's bar heights, left to right, as drawn in the design (152:527-543). */
const BARS = [8, 24, 38, 24, 24, 18, 18, 18, 18, 18, 18, 8, 18, 34, 18, 12, 18];

/* The circle: three discs from the design's SVG, drawn in one 239px frame. */
const RING_R = 110;
const RING_LEN = 2 * Math.PI * RING_R;

function Circle({ children, progress }: { children: React.ReactNode; progress?: number }) {
  return (
    <span className="voice-circle" aria-hidden="true">
      <svg viewBox="0 0 239 239" width="239" height="239" className="voice-circle__discs">
        <circle cx="119.5" cy="119.5" r="119.5" fill="#D5DDAD" />
        <circle cx="119" cy="118" r="113" fill="#E5EACB" />
        <circle cx="119" cy="118" r="105" fill="#F7F8F2" />
        {progress !== undefined ? (
          // Time used, drawn clockwise from the top in the design's lime (152:524).
          <circle
            cx="119.5" cy="119.5" r={RING_R} fill="none" stroke="#A7BD1F" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN * (1 - Math.min(1, progress))}
            transform="rotate(-90 119.5 119.5)" className="voice-circle__progress"
          />
        ) : null}
      </svg>
      <span className="voice-circle__content">{children}</span>
    </span>
  );
}

function MicGlyph() {
  // The mic from the design's own SVG (152:236), not an icon-set look-alike.
  return (
    <svg viewBox="92 90 56 66" width="56" height="66" fill="#567621" aria-hidden="true">
      <path d="M119.504 93.9167C111.335 93.9167 104.713 100.539 104.713 108.708V120.542C104.713 128.711 111.335 135.333 119.504 135.333C127.673 135.333 134.296 128.711 134.296 120.542V108.708C134.296 100.539 127.673 93.9167 119.504 93.9167Z" />
      <path d="M101.32 130.764C100.43 129.394 98.5984 129.004 97.2278 129.894C95.8573 130.783 95.4672 132.615 96.3567 133.986C99.6807 139.108 106.033 145.919 116.546 147.015V150.125C116.546 151.759 117.87 153.083 119.504 153.083C121.138 153.083 122.462 151.759 122.462 150.125V147.015C132.975 145.919 139.328 139.108 142.652 133.986C143.541 132.615 143.151 130.783 141.78 129.894C140.41 129.004 138.578 129.394 137.688 130.764C134.613 135.504 128.971 141.25 119.504 141.25C110.037 141.25 104.395 135.504 101.32 130.764Z" />
    </svg>
  );
}

function Processing() {
  const { pending } = useFormStatus();
  return pending ? <p className="voice-status" role="status">Listening to your recording and working out what you need…</p> : null;
}

/** Screens 1 and 2: tap the mic to record, the arc fills as time passes, "End recording" sends it. */
function Capture({ onReady }: { onReady: (dataUrl: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
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
        reader.onload = () => onReady(String(reader.result ?? ""));
        reader.readAsDataURL(blob);
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
      timerRef.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_SECONDS * 1000);
    } catch {
      setError("We could not reach your microphone. Allow it in your browser, or fill in the form instead.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearTimeout(timerRef.current);
    mediaRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="voice-capture">
      {recording ? (
        <>
          <Circle progress={seconds / MAX_SECONDS}>
            <span className="voice-wave">
              {BARS.map((h, i) => <span key={i} style={{ height: h, animationDelay: `${i * 0.06}s` }} />)}
            </span>
          </Circle>
          <span className="sr-only" role="timer" aria-live="polite">{seconds} seconds recorded</span>
          <button type="button" className="qr-btn qr-btn--soft" onClick={stopRecording}>End recording</button>
        </>
      ) : (
        <>
          <button type="button" className="voice-capture__mic" onClick={() => void startRecording()} aria-label="Start recording">
            <Circle><MicGlyph /></Circle>
          </button>
          <p className="voice-capture__hint">Tap the icon to record</p>
          <Processing />
          {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
          <div className="voice-script">
            <p className="voice-script__title">Before you record, tell us:</p>
            <ul>
              {SCRIPT.map((s) => (
                <li key={s.en}><strong>{s.krio}</strong><span>{s.en}</span></li>
              ))}
            </ul>
          </div>
        </>
      )}
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
  const [hideReview, setHideReview] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const audioField = useRef<HTMLInputElement>(null);
  const showReview = "ok" in state && state.ok && !hideReview;

  // Ending the recording sends it straight to be transcribed — the design goes record → review.
  function onReady(dataUrl: string) {
    setHideReview(false);
    setShowForm(false);
    if (audioField.current) {
      audioField.current.value = dataUrl;
      audioField.current.form?.requestSubmit();
    }
  }

  if (showReview && "ok" in state && state.ok) {
    return (
      <div className="voice-review">
        <div className="voice-review__card">
          <h3>Your request</h3>
          <p>{state.transcript}</p>
        </div>
        {!showForm ? (
          <>
            <p className="voice-review__note">Select any part of your request to edit it.</p>
            <div className="voice-review__actions">
              <button type="button" className="qr-btn qr-btn--soft" onClick={() => setHideReview(true)}>Record again</button>
              {/* Sending reveals the filled-in form, which the farmer checks and sends themselves. */}
              <button type="button" className="qr-btn" onClick={() => setShowForm(true)}>Send request</button>
            </div>
          </>
        ) : (
          <>
            {state.missing.length > 0 ? (
              <p className="voice-review__note">We still need: {state.missing.join(", ")}. Fill those in below.</p>
            ) : (
              <p className="voice-review__note">Check the details below, then send.</p>
            )}
            <div className="modal modal--book guest__panel voice-review__form">
              <BookForm services={services} districts={districts} initial={state.initial} direct={direct} submissionKey={submissionKey} guest={guest} cancelHref={cancelHref} />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="voice-form">
      <input ref={audioField} type="hidden" name="audio" defaultValue="" />
      <Capture onReady={onReady} />
      {"ok" in state && !state.ok ? <p className="notice notice--error" role="alert">{state.reason}</p> : null}
    </form>
  );
}
