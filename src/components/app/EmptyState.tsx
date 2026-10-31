import Link from "next/link";
import { Icon, type IconName } from "./Icon";

/** What is missing, and the next thing to do about it. */
export function EmptyState({ icon, title, body, href, action }: { icon: IconName; title?: string; body: string; href?: string; action?: string }) {
  return (
    <div className="empty empty--card">
      <span className="home-card__icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
      {title ? <strong className="empty__title">{title}</strong> : null}
      <span className="empty__body">{body}</span>
      {href && action ? <Link href={href} className="button button--inline">{action}</Link> : null}
    </div>
  );
}
