import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { SERVICES } from "@/lib/business";
import { AVAILABILITY, KINDS, MAX_GALLERY_PHOTOS, kindLabel, listAssets, listPhotos, unavailableReason } from "@/lib/equipment";
import { EquipmentList, type AssetView } from "@/components/equipment/EquipmentList";

export const metadata: Metadata = { title: "Equipment" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, business, permission } = await requireWorkspace();
  const assets: AssetView[] = await Promise.all((await listAssets(business.id)).map(async (a) => {
    const gallery = await listPhotos(business.id, a.id);
    return {
      id: a.id,
      kind: a.kind,
      kindLabel: kindLabel(a.kind),
      name: a.name,
      identifier: a.identifier,
      ownership: a.ownership,
      status: a.status,
      notes: a.notes,
      retiredReason: a.retiredReason,
      brand: a.brand,
      model: a.model,
      year: a.year,
      horsepower: a.horsepower,
      implements: a.implements,
      services: a.services,
      availability: a.availability,
      photo: a.photoAt ? `/provider/equipment/photo/${a.id}?v=${encodeURIComponent(a.photoAt)}` : null,
      gallery: gallery.map((p) => ({ id: p.id, src: `/provider/equipment/gallery/${p.id}` })),
      galleryFull: gallery.length >= MAX_GALLERY_PHOTOS,
      unavailable: unavailableReason(a),
      faults: a.openFaults.map((f) => ({
        id: f.id, severity: f.severity, description: f.description, reportedAt: f.reportedAt,
      })),
    };
  }));

  return (
    <Shell crumb={{ label: "Equipment", icon: "equipment" }} user={{ name: user.name }}>
      <PageHead
        title="Equipments"
        subtitle="Manage the equipments you use for farm services"
      />
      <EquipmentList
        assets={assets}
        kinds={KINDS.map((k) => ({ ...k }))}
        services={SERVICES.map((s) => ({ ...s }))}
        availability={AVAILABILITY.map((a) => ({ ...a }))}
        canEdit={permission !== "view_jobs"}
      />
    </Shell>
  );
}
