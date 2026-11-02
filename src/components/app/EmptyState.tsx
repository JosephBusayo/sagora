import Link from "next/link";
import { Icon, type IconName } from "./Icon";

/**
 * What is missing, and the next thing to do about it, as the design draws it: a large grey icon,
 * a heading, a quieter line under it, and a button when there is an obvious next step.
 */
export function EmptyState({ icon, title, body, href, action }: { icon: IconName; title: string; body: string; href?: string; action?: string }) {
  return (
    <div className="empty empty--card">
      <span className="empty__icon" aria-hidden="true"><Icon name={icon} size={49} /></span>
      <strong className="empty__title">{title}</strong>
      <span className="empty__body">{body}</span>
      {href && action ? <Link href={href} className="button button--inline">{action}</Link> : null}
    </div>
  );
}
