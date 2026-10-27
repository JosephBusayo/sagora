import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import type { IconName } from "@/components/app/Icon";

/** Honest stand-in for a sidebar section that is designed but not built yet. */
export async function Placeholder({ title, icon }: { title: string; icon: IconName }) {
  const { user } = await requireWorkspace();
  return (
    <Shell crumb={{ label: title, icon }} user={{ name: user.name }}>
      <PageHead title={title} subtitle="Designed in Figma. Not built yet." />
      <p className="empty">Nothing here is live. This section is next in the build.</p>
    </Shell>
  );
}
