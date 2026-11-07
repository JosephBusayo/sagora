import { PendingButton } from "@/components/app/PendingButton";
import { DISTRICTS, SERVICES, districtLabel } from "@/lib/business";
import type { CoverageRow } from "@/lib/coverage";
import { addAreaAction, dropAreaAction } from "@/app/(platform)/provider/(app)/settings/actions";

const label = (id: string) => SERVICES.find((s) => s.id === id)?.label ?? id;

/** UC04: every district the business takes requests from, and for which services. New ones wait for review. */
export function WorkAreas({ rows, canEdit }: { rows: CoverageRow[]; canEdit: boolean }) {
  const districts = [...new Set(rows.map((r) => r.district))];
  return (
    <section className="panel work-areas" id="areas" aria-labelledby="areas-title">
      <h2 className="quotes__heading" id="areas-title">Where you work</h2>
      <p className="field__helper">
        Requests reach you from these districts, for these services. Sagora checks a new district or service before
        requests start coming from it.
      </p>
      <ul className="work-areas__list">
        {districts.map((d) => (
          <li key={d} className="work-areas__district">
            <strong>{districtLabel(d)}</strong>
            <ul className="work-areas__services">
              {rows.filter((r) => r.district === d).map((r) => (
                <li key={r.service} className="work-areas__service">
                  <span>{label(r.service)}</span>
                  {r.status === "pending" ? <span className="pill pill--in_progress">Waiting for review</span> : null}
                  {canEdit ? (
                    <form action={dropAreaAction}>
                      <input type="hidden" name="district" value={r.district} />
                      <input type="hidden" name="service" value={r.service} />
                      <PendingButton className="work-areas__drop" aria-label={`Stop ${label(r.service)} in ${r.district}`}
                        confirm={`Stop ${label(r.service).toLowerCase()} in ${r.district}?`}
                        confirmBody="New requests from there stop at once. Quotes and jobs you already have are not changed."
                        confirmAction="Stop">Remove</PendingButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form action={addAreaAction} className="form-soft work-areas__add">
          <div className="field">
            <label className="field__label" htmlFor="area-district">Add a district</label>
            <div className="field__box">
              <select id="area-district" name="district" className="field__input" defaultValue="" required>
                <option value="">Select a district</option>
                {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <fieldset className="field setup__services">
            <legend className="field__label">Services there</legend>
            <div className="setup__checks">
              {SERVICES.map((s) => (
                <label key={s.id} className="setup__check">
                  <input type="checkbox" name="services" value={s.id} />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <PendingButton className="button button--inline">Send for review</PendingButton>
        </form>
      ) : null}
    </section>
  );
}
