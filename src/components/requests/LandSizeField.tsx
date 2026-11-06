"use client";

import { LAND_UNITS, landUnit } from "@/lib/land-size";

/** The size as typed, with the unit it is in. The server turns hectares into acres. */
export function LandSizeField({ value, unit, error, id = "f-acres" }: { value?: string; unit?: string; error?: string; id?: string }) {
  const chosen = landUnit(unit);
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>Land size</label>
      <div className="field__box">
        <input id={id} name="acres" className="field__input" inputMode="decimal" placeholder="Land size" defaultValue={value} />
        <select key={chosen} name="unit" aria-label="Unit" className="field__unit" defaultValue={chosen} data-check-append>
          {LAND_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}
