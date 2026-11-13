"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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

/**
 * The screen between recording and the transcript. It replaces the mic and the prompt card
 * outright: once the recording has ended there is nothing left to tap, and the farmer needs to
 * see plainly that Sagora is working rather than wonder whether anything happened at all.
 */
function Processing() {
  return (
    <div className="voice-processing" role="status" aria-live="polite">
      <Circle>
        <span className="voice-processing__dots" aria-hidden="true">
          <span /><span /><span />
        </span>
      </Circle>
      <h3 className="voice-processing__title">Listening to your recording</h3>
      <p className="voice-processing__note">Working out what work you need, where, and when. This takes a few seconds — please wait.</p>
    </div>
  );
}

/** Screens 1 and 2: tap the mic to record, the arc fills as time passes, "End recording" sends it. */
function Capture({ onReady, onSending, notice }: { onReady: (dataUrl: string) => void; onSending: () => void; notice?: string }) {
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
      // The cap stops the recording the same way the button does, so the farmer sees the same
      // processing screen either way rather than being dropped back on the mic.
      timerRef.current = setTimeout(() => recorder.state === "recording" && stopRecording(), MAX_SECONDS * 1000);
    } catch {
      setError("We could not reach your microphone. Allow it in your browser, or fill in the form instead.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearTimeout(timerRef.current);
    mediaRef.current?.stop();
    setRecording(false);
    // Said now, not when the clip finishes encoding: reading the blob takes a moment, and the mic
    // must not reappear in the gap.
    onSending();
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
          {/* Both sit above the prompt card, by the mic they are about — below it they were far
              enough down the screen to be missed entirely. */}
          {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
          {notice ? <p className="notice notice--error" role="alert">{notice}</p> : null}
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
  // Set when the recording ends, which is the start of the wait — earlier than the form's own
  // pending status, because encoding the clip takes a moment and the mic must not flash back on.
  const [sending, setSending] = useState(0);
  // The recorder's own callback runs later, from a render that happened before the count went up,
  // so the count lives in a ref and the state above only exists to redraw the screen.
  const sentRef = useRef(0);
  const sentField = useRef<HTMLInputElement>(null);
  const audioField = useRef<HTMLInputElement>(null);
  const showReview = "ok" in state && state.ok && !hideReview;
  // Still waiting while no answer has come back for *this* recording. Comparing the number rather
  // than just looking for a result keeps the previous recording's result from ending the wait.
  const waiting = sending > 0 && (!("sent" in state) || state.sent !== sending);

  // Ending the recording sends it straight to be transcribed — the design goes record → review.
  function onReady(dataUrl: string) {
    setHideReview(false);
    setShowForm(false);
    // Nothing captured: go back to the mic rather than wait on an answer that cannot come.
    if (!dataUrl || !audioField.current || !sentField.current) return setSending(0);
    audioField.current.value = dataUrl;
    sentField.current.value = String(sentRef.current);
    audioField.current.form?.requestSubmit();
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
    // The form stays mounted either way: ending the recording submits it from the recorder's own
    // callback, which needs the hidden field to still be there.
    <form action={action} className="voice-form">
      <input ref={audioField} type="hidden" name="audio" defaultValue="" />
      <input ref={sentField} type="hidden" name="sent" defaultValue="0" />
      {waiting ? <Processing /> : (
        <Capture
          onReady={onReady}
          onSending={() => setSending((sentRef.current += 1))}
          notice={"ok" in state && !state.ok ? state.reason : undefined}
        />
      )}
    </form>
  );
}
