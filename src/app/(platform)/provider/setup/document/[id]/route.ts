import { getBusinessForUser } from "@/lib/business";
import { readDocument } from "@/lib/business-documents";
import { requireProvider } from "@/lib/session";

/** One of the business's own application documents, for the owner who added it. Nobody else. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireProvider();
  const business = await getBusinessForUser(user.id);
  const doc = business ? await readDocument(business.id, (await params).id) : null;
  if (!doc) return new Response("Not found", { status: 404 });
  return fileResponse(doc);
}

function fileResponse(doc: { mime: string; fileName: string; data: Buffer }) {
  return new Response(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
