"use client";

import { useActionState, useRef, useState } from "react";
import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { PendingButton } from "@/components/app/PendingButton";
import { removeDocumentAction, uploadDocumentAction } from "@/app/(platform)/provider/setup/actions";
import type { FormState } from "@/app/(platform)/provider/actions";

type Doc = { id: string; kind: string; kindLabel: string; fileName: string };

const KINDS = [
  { id: "id", label: "ID of the person in charge" },
  { id: "registration", label: "Business registration" },
  { id: "other", label: "Other supporting document" },
];

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_SIDE = 1600;

const asDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

/** A phone photo of a card is several MB: shrink it so it sends on mobile data and stays readable. */
async function prepare(file: File): Promise<string> {
  if (file.type === "application/pdf") return asDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * ID and registration papers for the review (UC02). Each file is saved on its own as soon as it
 * is chosen, so a dropped connection loses one upload, never the whole application.
 */
export function DocumentsSection({ docs }: { docs: Doc[] }) {
  const [state, action] = useActionState(useSafely(uploadDocumentAction), {} as FormState);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const fileField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    setProblem("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type) && !file.type.startsWith("image/")) {
      setProblem("Use a photo or a PDF.");
      return;
    }
    if (file.type === "application/pdf" && file.size > MAX_BYTES) {
      setProblem("That PDF is larger than 3 MB. Take a photo of the page instead.");
      return;
    }
    setBusy(true);
    try {
      fileField.current!.value = await prepare(file);
      nameField.current!.value = file.name;
      form.current!.requestSubmit();
    } catch {
      setProblem("That file could not be read. Try another one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="setup__docs" aria-labelledby="docs-title">
      <h2 id="docs-title">Documents</h2>
      <p className="field__helper">
        Sagora needs the ID of the person in charge. A registered company also needs its registration certificate.
        If you are an individual owner or a group without a certificate, add what you have and Sagora will tell you what else it accepts.
        Only Sagora&rsquo;s reviewers can see these.
      </p>
      {docs.length ? (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <a href={`/provider/setup/document/${d.id}`} target="_blank" rel="noopener">{d.kindLabel}: {d.fileName}</a>
              <form action={removeDocumentAction}>
                <input type="hidden" name="id" value={d.id} />
                <PendingButton className="resend__button" confirm="Remove this document?" confirmAction="Remove">Remove</PendingButton>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <form ref={form} action={action} className="form-soft doc-upload">
        <div className="field">
          <label className="field__label" htmlFor="doc-kind">What are you adding?</label>
          <div className="field__box">
            <select id="doc-kind" name="kind" className="field__input" defaultValue="id">
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
        </div>
        <label className="button button--ghost doc-upload__pick">
          {busy ? "Uploading…" : "Choose a photo or PDF"}
          <input type="file" accept="image/*,application/pdf" className="photo-pick__input" disabled={busy}
            onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <input type="hidden" name="file" ref={fileField} />
        <input type="hidden" name="fileName" ref={nameField} />
        {problem ? <p className="notice notice--error" role="alert">{problem}</p> : null}
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <FormNotice state={state} />
      </form>
    </section>
  );
}
