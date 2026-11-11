"use client";

import { useState } from "react";
import { Icon } from "@/components/app/Icon";
import { BookForm } from "./BookForm";
import { VoiceIntake } from "./VoiceIntake";

type Option = { id: string; label: string };

/**
 * One entry point, a choice first: fill in the form, or send a voice note. Joseph: these are two
 * ways to do the same thing — finding a provider — not two separate destinations, so there is one
 * "Find a service provider" button, not two.
 */
export function RequestEntry({ services, districts, service, direct, submissionKey, guest, cancelHref, voiceEnabled = true }: {
  services: readonly Option[]; districts: readonly string[]; service?: string;
  direct?: { id: string; name: string };
  submissionKey: string; guest: boolean; cancelHref: string;
  /** False when GOOGLE_GENERATIVE_AI_API_KEY is unset — the choice simply isn't offered. */
  voiceEnabled?: boolean;
}) {
  const [mode, setMode] = useState<"choose" | "form" | "voice">(voiceEnabled ? "choose" : "form");

  if (mode === "form") {
    return <BookForm services={services} districts={districts} service={service} direct={direct} submissionKey={submissionKey} guest={guest} cancelHref={cancelHref} />;
  }
  if (mode === "voice") {
    return <VoiceIntake services={services} districts={districts} direct={direct} submissionKey={submissionKey} guest={guest} cancelHref={cancelHref} />;
  }

  return (
    <div className="request-entry">
      <header className="book__head">
        <h2>How would you like to tell us?</h2>
        <p>Fill in a short form, or just say what you need in a voice note.</p>
      </header>
      <div className="request-entry__options">
        <button type="button" className="request-entry__option" onClick={() => setMode("form")}>
          <span className="request-entry__icon" aria-hidden="true"><Icon name="requests" size={28} /></span>
          <span className="request-entry__title">Fill in a form</span>
          <span className="request-entry__body">A few short steps: the work, your land, and when you want it done.</span>
        </button>
        <button type="button" className="request-entry__option" onClick={() => setMode("voice")}>
          <span className="request-entry__icon" aria-hidden="true"><Icon name="microphone" size={28} /></span>
          <span className="request-entry__title">Send a voice note</span>
          <span className="request-entry__body">Record it, or share one you already have. We will fill in the form for you.</span>
        </button>
      </div>
      <a href={cancelHref} className="button button--soft request-entry__cancel">Cancel</a>
    </div>
  );
}
