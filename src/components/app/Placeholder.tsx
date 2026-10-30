import { requireWorkspace } from "@/lib/guard";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { unreadCount } from "@/lib/notifications";
import type { IconName } from "@/components/app/Icon";
import type { Audience } from "@/components/app/nav";

/** Honest stand-in for a sidebar section that is designed but not built yet. */
export async function Placeholder({
  title,
  icon,
  audience = "provider",
}: {
  title: string;
  icon: IconName;
  audience?: Audience;
}) {
  // Each app has its own guard: a farmer must not be sent through the provider one, which
  // would bounce them to a workspace they have no business being in.
  const user = audience === "farmer" ? await requireFarmer() : (await requireWorkspace()).user;
  return (
    <Shell
      crumb={{ label: title, icon }}
      user={{ name: user.name }}
      audience={audience}
      unread={await unreadCount(user)}
    >
      <PageHead title={title} subtitle="Designed in Figma. Not built yet." />
      <p className="empty">Nothing here is live. This section is next in the build.</p>
    </Shell>
  );
}
