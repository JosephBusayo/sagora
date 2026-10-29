import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { Shell } from "@/components/app/Shell";
import { Icon, type IconName } from "@/components/app/Icon";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, listForFarmer, serviceLabel } from "@/lib/requests";
import { bookingsForFarmer } from "@/lib/jobs";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "requests", title: "Ask", body: "Say what work you need, where, and when. It costs nothing and books nothing." },
  { icon: "quotes", title: "Compare", body: "Providers near you send a price. You see what each one covers before you choose." },
  { icon: "payments", title: "Pay", body: "Accept a quote and pay. The dates are only held once the money is in." },
  { icon: "jobs", title: "Confirm", body: "When the work is done you confirm it. The provider is paid only after that." },
];

export default async function Page() {
  const farmer = await requireFarmer();
  const firstName = farmer.name.trim().split(/\s+/)[0];
  const requests = listForFarmer(farmer.id).slice(0, 4);
  const live = bookingsForFarmer(farmer.id).filter((b) =>
    ["scheduled", "in_progress", "work_reported"].includes(b.status),
  );

  return (
    <Shell
      crumb={{ label: "Home", icon: "home" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={unreadCount(farmer)}
    >
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Welcome, {firstName}</h1>
          <p className="pagehead__sub">Ask for ploughing or harvesting, and providers near you will quote.</p>
        </div>
      </div>

      {/* The two things a farmer comes here to do, as the design puts them: side by side, large. */}
      <div className="book-tiles">
        <Link href="/farmer/book?service=ploughing" className="book-tile">
          <span className="book-tile__icon" aria-hidden="true"><Icon name="equipment" size={26} /></span>
          <span className="book-tile__text">
            <strong>Book ploughing</strong>
            <span>Tractor and plough, priced per acre</span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
        <Link href="/farmer/book?service=harvesting" className="book-tile">
          <span className="book-tile__icon" aria-hidden="true"><Icon name="quotes" size={26} /></span>
          <span className="book-tile__text">
            <strong>Book harvesting</strong>
            <span>Harvester and crew for your field</span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
      </div>

      {live.length > 0 ? (
        <section className="panel panel--wide">
          <h2 className="quotes__heading">Happening now</h2>
          <ul className="plain-list">
            {live.map((b) => (
              <li key={b.id}>
                <span>
                  <strong>{b.reference}</strong> · {serviceLabel(b.service)} with {b.businessName}
                  {b.startDate ? ` · ${fmt(b.startDate)}` : ""}
                </span>
                <Link href="/farmer/bookings">
                  {b.status === "work_reported" ? "Confirm the work" : "See the booking"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel panel--wide">
        <h2 className="quotes__heading">Recent requests</h2>
        {requests.length === 0 ? (
          <p className="field__helper">You have not asked for any work yet.</p>
        ) : (
          <div className="table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Service</th>
                  <th scope="col">Where</th>
                  <th scope="col">Preferred date</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/farmer/requests/${r.id}`}>{r.reference}</Link></td>
                    <td>{serviceLabel(r.service)}</td>
                    <td>{r.village}, {districtLabel(r.district)}</td>
                    <td>{fmt(r.preferredDate)}</td>
                    <td><span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel panel--wide">
        <h2 className="quotes__heading">How it works</h2>
        <ol className="how">
          {STEPS.map((s, i) => (
            <li key={s.title} className="how__step">
              <span className="how__num" aria-hidden="true">{i + 1}</span>
              <span className="how__icon" aria-hidden="true"><Icon name={s.icon} size={20} /></span>
              <span className="how__body">
                <strong>{s.title}</strong>
                <span>{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="field__helper">
          Asking costs nothing, and a request is not a booking. Nothing is held until you accept a quote and pay.
        </p>
      </section>
    </Shell>
  );
}
