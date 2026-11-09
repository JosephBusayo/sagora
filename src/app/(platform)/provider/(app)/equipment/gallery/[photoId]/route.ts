import { requireWorkspace } from "@/lib/guard";
import { getGalleryPhoto } from "@/lib/equipment";

/** One extra equipment photo, only for the business that owns it. Same rules as the cover photo. */
export async function GET(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const { business } = await requireWorkspace();
  const photo = await getGalleryPhoto(business.id, (await params).photoId);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(photo.data, "base64")), {
    headers: { "Content-Type": photo.mime, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
