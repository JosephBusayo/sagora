"use client";

/**
 * Keeps a half-filled booking form in the browser, so leaving the page does not throw the
 * answers away. A farmer who switches to the voice note and back, reloads, closes the tab, or
 * walks off and comes back later finds what they had already typed still there.
 *
 * localStorage, not sessionStorage: sessionStorage dies with the tab, and "I closed it and came
 * back" is exactly the case this is for. It never leaves the device and is never sent anywhere.
 */

/** How long a draft is kept. It holds a name and a phone number, so it does not sit there for
 * ever on a shared phone - and a week-old half-filled form is not worth restoring anyway. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The form drives these itself; restoring them would fight it. */
const SKIP = new Set(["step", "requestId", "submissionKey", "directTo"]);

type Draft = { at: number; values: Record<string, string> };

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The named controls worth saving, in form order. */
function controls(form: HTMLFormElement): Control[] {
  return Array.from(form.elements).filter(
    (el): el is Control =>
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
      Boolean(el.name) && !SKIP.has(el.name),
  );
}

export function readDraft(key: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft | null;
    if (!draft?.values || typeof draft.at !== "number" || Date.now() - draft.at > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return draft.values;
  } catch {
    return null; // Private browsing, cleared storage, or something else wrote nonsense here.
  }
}

/**
 * Saves what is on screen now, merged over what was saved before. Only the fields actually shown
 * on this step are read: the hidden ones carrying the other step's answers are posted blank on
 * step one, and reading those would wipe answers the farmer has already given.
 */
export function saveDraft(key: string, form: HTMLFormElement): void {
  try {
    const values = { ...(readDraft(key) ?? {}) };
    for (const field of controls(form)) {
      if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) {
        if (field.checked) values[field.name] = field.value;
        continue;
      }
      if (field instanceof HTMLInputElement && field.type === "hidden") continue;
      values[field.name] = field.value;
    }
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), values } satisfies Draft));
  } catch {
    // Storage full or refused. The form still works; only the saving is lost.
  }
}

/**
 * Writes a value the way a person typing it would, so React sees the change rather than only
 * the DOM. React keeps its own record of what each field last held and ignores a plain
 * assignment; going through the prototype's setter updates that record too.
 *
 * It matters because some of this form appears only once React knows an answer: Crop shows when
 * a service is chosen, the chiefdoms follow the district. Setting the value silently would put
 * the answers back but leave those fields unbuilt.
 */
function setValue(field: Control, value: string): void {
  const proto = Object.getPrototypeOf(field) as object;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Puts a saved draft back into the form after it is drawn. Done to the rendered fields rather
 * than to what the server renders, because the server cannot see the browser's storage - markup
 * built from it would not match on hydration.
 *
 * A field the server or a voice note has already filled is left alone: those are newer. Safe to
 * run again whenever more of the form appears, since it only ever fills a field that is empty.
 */
export function restoreDraft(key: string, form: HTMLFormElement): void {
  const values = readDraft(key);
  if (!values) return;
  for (const field of controls(form)) {
    const saved = values[field.name];
    if (saved === undefined) continue;
    if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) {
      const want = field.value === saved;
      if (field.checked !== want) {
        field.checked = want;
        if (want) field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      continue;
    }
    if (field.value) continue;
    // Hidden fields carry the other step's answers, and are blank until the server has them -
    // which after a reload it no longer does. They are what survives step two across a refresh.
    // Nothing watches them, so they are set plainly.
    if (field instanceof HTMLInputElement && field.type === "hidden") field.value = saved;
    else setValue(field, saved);
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do: an unreadable store is an empty one as far as this is concerned.
  }
}
