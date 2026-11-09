import Link from "next/link";
import { nudge } from "@/lib/outbox";
import { Sidebar } from "./Sidebar";
import { SearchBox } from "./SearchBox";
import { TableLabels } from "./TableLabels";
import { Icon, type IconName } from "./Icon";
import type { Audience } from "./nav";
import { signOut } from "@/app/(platform)/provider/actions";
import { signOutFarmer } from "@/app/(platform)/farmer/actions";
import { signOutStaff } from "@/app/(platform)/staff/actions";

const SIGN_OUT = { provider: signOut, farmer: signOutFarmer, staff: signOutStaff };

type Props = {
  /** Breadcrumb shown at the top left, as in the design. */
  crumb: { label: string; icon: IconName };
  user: { name: string };
  /** Which app this is. They differ only in their sidebar and where the links point. */
  audience?: Audience;
  /** Unread notifications, shown on the bell. */
  unread?: number;
  /** Staff admins see the pages only admins may use. */
  admin?: boolean;
  /** Staff with finance-desk access see Payments. Everyone else does not, even by URL. */
  finance?: boolean;
  /** What is in the search box, on the search results page. */
  search?: string;
  children: React.ReactNode;
};

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/**
 * The name as the design writes it: first name, then the initial of the last. "Joseph Jayeoba"
 * becomes "Joseph J". A full name wraps onto a second line in the space the design allows, and
 * a wrapped name is what makes the avatar beside it look squashed.
 */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}`;
}

export function Shell({ crumb, user, audience = "provider", unread = 0, admin = false, finance = true, search, children }: Props) {
  // Every signed-in page view helps the notification queue along (see lib/outbox.ts).
  nudge();
  const base = `/${audience}`;
  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar audience={audience} signOutAction={SIGN_OUT[audience]} admin={admin} finance={finance} />
      <div className="app__panel">
        <header className="topbar">
          <p className="topbar__crumb">
            <Icon name={crumb.icon} size={18} />
            <span>{crumb.label}</span>
          </p>
          <SearchBox key={search} base={base} initial={search} placeholder={audience === "staff" ? "Search requests and providers..." : undefined} />
          <div className="topbar__actions">
            <Link
              href={`${base}/notifications`}
              className="topbar__round"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            >
              <Icon name="bell" size={20} />
              {unread > 0 ? <span className="topbar__dot" aria-hidden="true">{unread > 9 ? "9+" : unread}</span> : null}
            </Link>
            <Link href={`${base}/settings`} className="topbar__round" aria-label="Settings">
              <Icon name="settings" size={20} />
            </Link>
            <Link href={`${base}/settings/account`} className="topbar__user" aria-label={`Account, ${user.name}`}>
              <span className="topbar__avatar" aria-hidden="true">{initial(user.name)}</span>
              <span className="topbar__name" title={user.name}>{shortName(user.name)}</span>
              <span className="topbar__chev"><Icon name="chevron" size={12} /></span>
            </Link>
          </div>
        </header>
        {/* Washes out the page while the search box is in use, as the design shows it. */}
        <div className="app__dim" aria-hidden="true" />
        <main id="main" className="app__content">{children}<TableLabels /></main>
      </div>
    </div>
  );
}

/** Page title + subtitle, with an optional action on the right (e.g. "Invite team member"). */
export function PageHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="pagehead">
      <div>
        <h1 className="pagehead__title">{title}</h1>
        {subtitle ? <p className="pagehead__sub">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
