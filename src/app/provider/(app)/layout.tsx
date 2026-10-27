import { requireWorkspace } from "@/lib/guard";

/** Guards everything in the workspace. Each page draws its own shell and breadcrumb. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace();
  return <>{children}</>;
}
