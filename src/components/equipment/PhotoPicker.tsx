"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/app/Icon";

/** Longest side, in pixels, after shrinking. Plenty for a card and the details window. */
const MAX_SIDE = 1200;

/**
 * Shrinks a phone photo in the browser before it is sent: a 4 MB camera picture becomes a JPEG
 * of about 150 KB, which matters on mobile data and keeps it small enough to store with the record.
 */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

/**
 * Picks one photo and puts it, shrunk, into a hidden field named `name`. `onPicked` runs once the
 * field holds the new photo, so a form can send itself straight away.
 */
export function PhotoPicker({ name, label, current, onPicked }: {
  name: string; label: string; current?: string | null; onPicked?: (form: HTMLFormElement | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const hidden = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a photo");
      return;
    }
    try {
      const url = await shrink(file);
      hidden.current!.value = url;
      setPreview(url);
      onPicked?.(hidden.current!.form);
    } catch {
      setError("That photo could not be read. Try another one.");
    }
  }

  const shown = preview ?? current;
  return (
    <div className={`field photo-pick${error ? " field--invalid" : ""}`}>
      <span className="field__label">{label}</span>
      <label className="photo-pick__box">
        {shown ? <img src={shown} alt="" className="photo-pick__img" /> : <Icon name="plus" size={22} />}
        <span className="photo-pick__text">{shown ? "Change photo" : "Add a photo"}</span>
        <input type="file" accept="image/*" className="photo-pick__input" onChange={(e) => void choose(e.target.files?.[0])} />
      </label>
      <input type="hidden" name={name} ref={hidden} />
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}
