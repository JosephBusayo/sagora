import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { SERVICES } from "@/lib/business";
import {
  AVAILABILITY, KINDS, MAX_GALLERY_PHOTOS, SERIAL_STATES, conditionLabel, kindLabel, limitedUseNote,
  listAssets, listPhotos, locationAgeDays, unavailableReason,
} from "@/lib/equipment";
import { describeSpecs } from "@/lib/specs";
import { VERDICTS, pairingsFor, readinessFor } from "@/lib/pairing";
import { implementKindsFor } from "@/lib/catalogue";
import { EquipmentList, type AssetView } from "@/components/equipment/EquipmentList";

export const metadata: Metadata = { title: "Equipment" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, business, permission } = await requireWorkspace();
  // What this business can actually do, worked out from the register rather than from what they
  // ticked on their profile. "Readiness still needs a fresh date-specific capacity check before
  // quotation" — this is about owning the right kit, not about next Tuesday.
  const readiness = await readinessFor(business.id, SERVICES.map((x) => x.id));
  const pairings = await pairingsFor(business.id);
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
      // Which implements could go with this machine, and what has been decided about each.
      pairings: pairings.filter((x) => x.machineId === a.id).map((x) => ({
        implementId: x.implementId, service: x.service, verdict: x.verdict, basis: x.basis, decidedAt: x.decidedAt,
      })),
      assetRef: a.assetRef,
      serialStatus: a.serialStatus,
      serialExceptionBy: a.serialExceptionBy,
      condition: a.condition,
      conditionLabel: conditionLabel(a.condition),
      conditionNote: limitedUseNote(a) ?? a.conditionNote,
      location: a.location,
      custodian: a.custodian,
      locationAgeDays: locationAgeDays(a),
      lessor: a.lessor,
      leaseFrom: a.leaseFrom,
      leaseTo: a.leaseTo,
      leaseNotes: a.leaseNotes,
      specs: a.specs,
      specRows: describeSpecs(a.kind, a.specs),
      acquiredOn: a.acquiredOn,
      supplier: a.supplier,
      donor: a.donor,
      useRestrictions: a.useRestrictions,
      faults: a.openFaults.map((f) => ({
        id: f.id, severity: f.severity, description: f.description, reportedAt: f.reportedAt,
      })),
    };
  }));

  return (
    <Shell crumb={{ label: "Equipment", icon: "equipment" }} user={{ name: user.name }}>
      <PageHead
        title="Equipments"
        subtitle="Manage the equipment you use for farm services"
      />
      <EquipmentList
        assets={assets}
        kinds={KINDS.map((k) => ({ ...k }))}
        services={SERVICES.map((s) => ({ ...s }))}
        availability={AVAILABILITY.map((a) => ({ ...a }))}
        serialStates={SERIAL_STATES.map((x) => ({ ...x }))}
        readiness={readiness.map((r) => ({ service: r.service, summary: r.summary, ready: r.ready }))}
        verdicts={VERDICTS.map((v) => ({ id: v.id, label: v.label }))}
        pairableServices={SERVICES.map((x) => ({ id: x.id, label: x.label, kinds: implementKindsFor(x.id) }))}
        canEdit={permission !== "view_jobs"}
      />
    </Shell>
  );
}
