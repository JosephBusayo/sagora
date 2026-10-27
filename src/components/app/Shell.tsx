import { Sidebar } from "./Sidebar";
import { Icon, type IconName } from "./Icon";
import { signOut } from "@/app/provider/actions";

type Props = {
  /** Breadcrumb shown at the top left, as in the design. */
  crumb: { label: string; icon: IconName };
  user: { name: string };
  children: React.ReactNode;
};

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export function Shell({ crumb, user, children }: Props) {
  return (
    <div className="app">
      <Sidebar signOutAction={signOut} />
      <div className="app__panel">
        <header className="topbar">
          <p className="topbar__crumb">
            <Icon name={crumb.icon} size={18} />
            <span>{crumb.label}</span>
          </p>
          {/* Search is not wired up yet: it needs requests, jobs and equipment to exist. */}
          <div className="topbar__search">
            <Icon name="search" size={18} />
            <input type="search" placeholder="Search requests, jobs, equipments..." aria-label="Search" disabled />
          </div>
          <div className="topbar__actions">
            <span className="topbar__round" aria-hidden="true"><Icon name="bell" size={18} /></span>
            <span className="topbar__round" aria-hidden="true"><Icon name="settings" size={18} /></span>
            <span className="topbar__user">
              <span className="topbar__avatar" aria-hidden="true">{initial(user.name)}</span>
              <span className="topbar__name">{user.name}</span>
              <Icon name="chevron" size={16} />
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
