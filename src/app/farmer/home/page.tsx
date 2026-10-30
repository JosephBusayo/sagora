import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { Shell } from "@/components/app/Shell";
import { Icon, type IconName } from "@/components/app/Icon";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, listForFarmer, serviceLabel } from "@/lib/requests";
import { unreadCount } from "@/lib/notifications";
import { greeting, todayLong } from "@/lib/greeting";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });

/**
 * The two services, and the three steps, with the designer's own words (Figma 1:2267).
 * The wording is the design's, not a paraphrase: this screen is the first thing a farmer
 * reads, and it is the designer's job to decide what it says.
 */
const SERVICES: { href: string; icon: IconName; title: string; body: string }[] = [
  {
    href: "/farmer/book?service=ploughing",
    icon: "equipment",
    title: "Book ploughing service",
    body: "Prepare your land for planting",
  },
  {
    href: "/farmer/book?service=harvesting",
    icon: "quotes",
    title: "Book harvesting service",
    // The design reads "crups"; corrected here, and raised with the designer.
    body: "Harvest your crops efficiently",
  },
];

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "requests", title: "Tell us what you need", body: "Choose service, farm size, location and preferred date" },
  { icon: "quotes", title: "Receive quotes", body: "Verified service providers in your area will send quotes" },
  { icon: "team", title: "Choose a provider", body: "Compare quotes and get work done" },
];

export default async function Page() {
  const farmer = await requireFarmer();
  const firstName = farmer.name.trim().split(/\s+/)[0];
  const requests = (await listForFarmer(farmer.id)).slice(0, 3);

  return (
    <Shell
      crumb={{ label: "Home", icon: "home" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <div className="greeting">
        <p className="greeting__date">{todayLong()}</p>
        <h1 className="greeting__title">{greeting()}, {firstName}</h1>
        <p className="greeting__sub">Get farm work done with trusted service providers in your area</p>
      </div>

      <div className="home-cards home-cards--two home-section">
        {SERVICES.map((s) => (
          <Link key={s.href} href={s.href} className="home-card">
            <span className="home-card__icon" aria-hidden="true"><Icon name={s.icon} size={24} /></span>
            <span className="home-card__text">
              <strong>{s.title}</strong>
              <span>{s.body}</span>
            </span>
            <Icon name="chevron" size={24} />
          </Link>
        ))}
      </div>

      {/* The design puts "How it works" above the requests table: a farmer who has never used
          this needs the explanation before the list, and the list is empty for them anyway. */}
      <section className="home-section">
        <div className="home-section__head">
          <h2 className="home-section__title">How it works</h2>
        </div>
        <div className="home-cards home-cards--three">
          {STEPS.map((s) => (
            <div key={s.title} className="home-card">
              <span className="home-card__icon" aria-hidden="true"><Icon name={s.icon} size={24} /></span>
              <span className="home-card__text">
                <strong>{s.title}</strong>
                <span>{s.body}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section__head">
          <h2 className="home-section__title">Your recent requests</h2>
          {requests.length > 0 ? (
            <Link href="/farmer/requests" className="home-section__more">
              See all <Icon name="arrowOut" size={24} />
            </Link>
          ) : null}
        </div>
        {requests.length === 0 ? (
          <div className="table-card"><p className="empty">You have not asked for any work yet.</p></div>
        ) : (
          <div className="table-card">
            <table className="table table--requests">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Service</th>
                  <th scope="col">Location</th>
                  <th scope="col">Farm size</th>
                  <th scope="col">Preferred date</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="table__ref">
                        <span className="table__ref-icon" aria-hidden="true"><Icon name="equipment" size={24} /></span>
                        <Link href={`/farmer/requests/${r.id}`}>{r.reference}</Link>
                      </span>
                    </td>
                    <td>{serviceLabel(r.service)}</td>
                    <td>{districtLabel(r.district)}</td>
                    <td>{r.acres} acres</td>
                    <td>{fmt(r.preferredDate)}</td>
                    <td><span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="table__go"><Icon name="chevron" size={22} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
