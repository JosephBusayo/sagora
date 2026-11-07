import { audit } from "@/lib/business";
import { db } from "@/lib/db";
import { readDocument } from "@/lib/business-documents";
import { requireStaff } from "@/lib/session";

/** A provider's application document, for Sagora staff only. Every opening is logged. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const id = (await params).id;
  const row = await db.get("SELECT business_id FROM business_document WHERE id=?", id) as { business_id: string } | undefined;
  const doc = row ? await readDocument(row.business_id, id) : null;
  if (!row || !doc) return new Response("Not found", { status: 404 });
  await audit(staff.id, "business.document_viewed", row.business_id, id);
  return new Response(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
