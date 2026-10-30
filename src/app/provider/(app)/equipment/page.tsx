import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { KINDS, kindLabel, listAssets, unavailableReason } from "@/lib/equipment";
import { EquipmentList, type AssetView } from "@/components/equipment/EquipmentList";

export const metadata: Metadata = { title: "Equipment" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, business, permission } = await requireWorkspace();
  const assets: AssetView[] = (await listAssets(business.id)).map((a) => ({
    id: a.id,
    kind: a.kind,
    kindLabel: kindLabel(a.kind),
    name: a.name,
    identifier: a.identifier,
    ownership: a.ownership,
    status: a.status,
    notes: a.notes,
    retiredReason: a.retiredReason,
    unavailable: unavailableReason(a),
    faults: a.openFaults.map((f) => ({
      id: f.id, severity: f.severity, description: f.description, reportedAt: f.reportedAt,
    })),
  }));

  return (
    <Shell crumb={{ label: "Equipment", icon: "equipment" }} user={{ name: user.name }}>
      <PageHead
        title="Equipments"
        subtitle="Manage the equipments you use for farm services"
      />
      <EquipmentList assets={assets} kinds={KINDS.map((k) => ({ ...k }))} canEdit={permission !== "view_jobs"} />
    </Shell>
  );
}
