import Link from "next/link";
import { Sidebar } from "./Sidebar";
import { Icon, type IconName } from "./Icon";
import type { Audience } from "./nav";
import { signOut } from "@/app/provider/actions";
import { signOutFarmer } from "@/app/farmer/actions";

type Props = {
  /** Breadcrumb shown at the top left, as in the design. */
  crumb: { label: string; icon: IconName };
  user: { name: string };
  /** Which app this is. The two differ only in their sidebar and where the bell points. */
  audience?: Audience;
  /** Unread notifications, shown on the bell. */
  unread?: number;
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

export function Shell({ crumb, user, audience = "provider", unread = 0, children }: Props) {
  const base = `/${audience}`;
  return (
    <div className="app">
      <Sidebar audience={audience} signOutAction={audience === "farmer" ? signOutFarmer : signOut} />
      <div className="app__panel">
        <header className="topbar">
          <p className="topbar__crumb">
            <Icon name={crumb.icon} size={18} />
            <span>{crumb.label}</span>
          </p>
          {/* A plain GET form, so search works with JavaScript off. */}
          <form className="topbar__search" action={`${base}/search`} role="search">
            <Icon name="search" size={18} />
            <input type="search" name="q" placeholder="Search requests, jobs, equipments..." aria-label="Search" maxLength={80} />
          </form>
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
            <span className="topbar__user">
              <span className="topbar__avatar" aria-hidden="true">{initial(user.name)}</span>
              <span className="topbar__name" title={user.name}>{shortName(user.name)}</span>
              <Icon name="chevron" size={24} />
            </span>
          </div>
        </header>
        <main className="app__content">{children}</main>
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
