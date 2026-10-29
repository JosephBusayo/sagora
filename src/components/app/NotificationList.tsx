import Link from "next/link";
import { Icon, type IconName } from "./Icon";
import { FILTERS, type Filter, type Notification } from "@/lib/notifications";

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * The notification list, shared by both apps because the design draws them the same way.
 * Marking one read is a plain form post, so it works with JavaScript off — a brief requirement
 * on the farmer side.
 */
export function NotificationList({
  notifications, filter, basePath, markReadAction, markAllAction,
}: {
  notifications: Notification[];
  filter: Filter;
  basePath: string;
  markReadAction: (fd: FormData) => Promise<void>;
  markAllAction: (fd: FormData) => Promise<void>;
}) {
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <>
      <div className="notif__top">
        <nav className="tabs tabs--page" aria-label="Filter notifications">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={f.id === "all" ? basePath : `${basePath}?filter=${f.id}`}
              className={`tab${f.id === filter ? " tab--on" : ""}`}
              aria-current={f.id === filter ? "page" : undefined}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {unread > 0 ? (
          <form action={markAllAction}>
            <input type="hidden" name="filter" value={filter} />
            <button type="submit" className="button button--ghost button--inline">Mark all as read</button>
          </form>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <div className="table-card">
          <p className="empty">
            {filter === "unread" ? "Nothing unread. You are up to date." : "No notifications yet."}
          </p>
        </div>
      ) : (
        <ul className="notif-list">
          {notifications.map((n) => (
            <li key={n.id} className={`notif${n.read ? "" : " notif--unread"}`}>
              <span className="notif__icon" aria-hidden="true">
                <Icon name={n.icon as IconName} size={20} />
              </span>
              <div className="notif__body">
                <p className="notif__head">
                  <span className="notif__kind">{n.label}</span>
                  <span className="notif__when">{when(n.at)}</span>
                </p>
                <h2 className="notif__subject">{n.subject}</h2>
                <p className="notif__text">{n.body.split("\n").filter(Boolean)[0]}</p>
                {!n.delivered ? (
                  <p className="field__helper">
                    We have not managed to email this to you yet. You are seeing it here first.
                  </p>
                ) : null}
              </div>
              {!n.read ? (
                <form action={markReadAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="filter" value={filter} />
                  <button type="submit" className="resend__button">Mark as read</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
