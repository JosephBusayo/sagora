import { PendingButton } from "@/components/app/PendingButton";
import { visitWhen } from "@/lib/visit-time";

export type VisitState = {
  status: "required" | "scheduled" | "completed";
  scheduledFor: string; scheduledTime: string;
  proposedFor: string; proposedTime: string; proposedSide: "farmer" | "provider" | "";
};

/**
 * Agreeing the day of a farm visit, for either side. One side suggests a day and time, the other
 * accepts it or suggests another, and only an accepted time books the visit. `me` is who is
 * looking; the forms are the same server actions whichever screen this sits on.
 */
export function VisitPanel({ me, visit, requestId, businessId, accept, suggest, otherName, idPrefix }: {
  me: "farmer" | "provider";
  visit: VisitState;
  requestId: string; businessId?: string;
  accept: (fd: FormData) => Promise<void>;
  suggest: (fd: FormData) => Promise<void>;
  /** The other side as the reader knows them: "the farmer", or the provider's name. */
  otherName: string;
  idPrefix: string;
}) {
  const waitingOnMe = visit.proposedFor && visit.proposedSide && visit.proposedSide !== me;
  const waitingOnThem = visit.proposedFor && visit.proposedSide === me;
  const proposed = visitWhen(visit.proposedFor, visit.proposedTime);
  const today = new Date().toISOString().slice(0, 10);

  const hidden = (
    <>
      <input type="hidden" name="requestId" value={requestId} />
      {businessId ? <input type="hidden" name="businessId" value={businessId} /> : null}
    </>
  );

  return (
    <div className="visit">
      {visit.status === "scheduled" ? (
        <p className="visit__state visit__state--booked">
          Visit booked for <strong>{visitWhen(visit.scheduledFor, visit.scheduledTime)}</strong>
        </p>
      ) : null}

      {waitingOnMe ? (
        <div className="visit__ask">
          <p className="visit__state">
            {otherName.charAt(0).toUpperCase() + otherName.slice(1)} suggested <strong>{proposed}</strong>
          </p>
          <form action={accept}>
            {hidden}
            <PendingButton className="button button--inline">Accept this time</PendingButton>
          </form>
        </div>
      ) : waitingOnThem ? (
        <p className="visit__state">You suggested <strong>{proposed}</strong>. Waiting for {otherName} to accept it.</p>
      ) : null}

      {visit.status !== "completed" ? (
        <form action={suggest} className="visit__form">
          {hidden}
          <p className="field__label visit__legend">
            {waitingOnMe ? "Or choose another day" : waitingOnThem ? "Change your suggestion" : visit.status === "scheduled" ? "Need a different day?" : "Choose a day for the visit"}
          </p>
          <div className="visit__fields">
            <div className="field">
              <label className="field__label" htmlFor={`${idPrefix}-day`}>Day</label>
              <div className="field__box">
                <input id={`${idPrefix}-day`} name="day" type="date" min={today} required className="field__input" suppressHydrationWarning />
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${idPrefix}-time`}>Time</label>
              <div className="field__box">
                <input id={`${idPrefix}-time`} name="time" type="time" className="field__input" />
              </div>
            </div>
            <PendingButton className="button button--soft button--inline">Send this day</PendingButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
