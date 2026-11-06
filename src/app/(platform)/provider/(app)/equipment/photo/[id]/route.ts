import { requireWorkspace } from "@/lib/guard";
import { getPhoto } from "@/lib/equipment";

/**
 * One piece of equipment's photo, only for the business that owns it. Knowing the address is not
 * enough: another provider, or someone signed out, gets nothing. The address carries ?v=, which
 * changes with the photo, so the browser may keep it for good.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireWorkspace();
  const photo = await getPhoto(business.id, (await params).id);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(photo.data, "base64")), {
    headers: { "Content-Type": photo.mime, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
