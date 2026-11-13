"use client";

import { useState } from "react";
import { BookForm } from "./BookForm";
import { VoiceIntake } from "./VoiceIntake";

type Option = { id: string; label: string };

/**
 * "Make a quick request": fill in the form, or send a voice note — a segmented choice, matching
 * the designer's "How would you like to tell us?" screen (Figma node 152:107/267/546).
 */
export function RequestEntry({ services, districts, service, direct, submissionKey, guest, cancelHref, voiceEnabled = true }: {
  services: readonly Option[]; districts: readonly string[]; service?: string;
  direct?: { id: string; name: string };
  submissionKey: string; guest: boolean; cancelHref: string;
  /** False when GOOGLE_GENERATIVE_AI_API_KEY is unset — the choice simply isn't offered. */
  voiceEnabled?: boolean;
}) {
  const [mode, setMode] = useState<"voice" | "form">(voiceEnabled ? "voice" : "form");

  return (
    <div className="request-entry">
      <header className="request-entry__head">
        <h2>How would you like to tell us?</h2>
        <p>Just say what you want in a voice note or fill in a short form.</p>
      </header>

      {voiceEnabled ? (
        <div className="request-entry__tabs" role="tablist" aria-label="How to send your request">
          <button type="button" role="tab" aria-selected={mode === "voice"} className={`request-entry__tab${mode === "voice" ? " request-entry__tab--active" : ""}`} onClick={() => setMode("voice")}>
            Send a voice note
          </button>
          <button type="button" role="tab" aria-selected={mode === "form"} className={`request-entry__tab${mode === "form" ? " request-entry__tab--active" : ""}`} onClick={() => setMode("form")}>
            Fill a form
          </button>
        </div>
      ) : null}

      {mode === "voice" ? (
        <VoiceIntake services={services} districts={districts} direct={direct} submissionKey={submissionKey} guest={guest} cancelHref={cancelHref} />
      ) : (
        // The form itself keeps its usual boxed card — only the choice screen above sits plain on the page.
        <div className="modal modal--book guest__panel">
          <BookForm services={services} districts={districts} service={service} direct={direct} submissionKey={submissionKey} guest={guest} cancelHref={cancelHref} />
        </div>
      )}
    </div>
  );
}
