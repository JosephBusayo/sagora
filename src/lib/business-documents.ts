import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";

/**
 * A provider's identity and registration papers (UC02). Private to the business and Sagora's
 * reviewers: no page links to one without checking who is asking, and none is ever listed to a
 * farmer or another provider.
 */

export const DOCUMENT_KINDS = [
  { id: "id", label: "ID of the person in charge" },
  { id: "registration", label: "Business registration" },
  { id: "other", label: "Other supporting document" },
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]["id"];
export const documentKindLabel = (k: string) => DOCUMENT_KINDS.find((d) => d.id === k)?.label ?? k;

/** What a reviewer can open: photos and PDFs. Anything else is refused at upload. */
const ALLOWED = ["image/jpeg", "image/png", "application/pdf"];
export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
/** Enough for any real application; stops a form being used as file storage. */
const MAX_PER_BUSINESS = 10;

export type BusinessDocument = { id: string; kind: DocumentKind; fileName: string; mime: string; sizeBytes: number; uploadedAt: string };

type Row = { id: string; kind: DocumentKind; file_name: string; mime: string; size_bytes: number; uploaded_at: string };
const fromRow = (r: Row): BusinessDocument => ({
  id: r.id, kind: r.kind, fileName: r.file_name, mime: r.mime, sizeBytes: Number(r.size_bytes), uploadedAt: r.uploaded_at,
});

export async function listDocuments(businessId: string): Promise<BusinessDocument[]> {
  const rows = await db.all("SELECT id, kind, file_name, mime, size_bytes, uploaded_at FROM business_document WHERE business_id=? ORDER BY uploaded_at ASC", businessId) as Row[];
  return rows.map(fromRow);
}

/** The file itself, only for the business it belongs to. Callers decide who may ask. */
export async function readDocument(businessId: string, id: string): Promise<{ mime: string; fileName: string; data: Buffer } | null> {
  const r = await db.get("SELECT mime, file_name, data FROM business_document WHERE id=? AND business_id=?", id, businessId) as
    { mime: string; file_name: string; data: string } | undefined;
  return r ? { mime: r.mime, fileName: r.file_name, data: Buffer.from(r.data, "base64") } : null;
}

/** A data URL from the browser, checked for type and size by what it actually contains. */
export function parseDocument(dataUrl: string): { mime: string; data: string; bytes: number } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m || !ALLOWED.includes(m[1])) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0 || buf.length > MAX_DOCUMENT_BYTES) return null;
  // The first bytes must match the type claimed, so a renamed file is not taken at its word.
  const head = buf.subarray(0, 5).toString("latin1");
  const ok = m[1] === "application/pdf" ? head === "%PDF-" : m[1] === "image/png" ? buf[0] === 0x89 && head.slice(1, 4) === "PNG" : buf[0] === 0xff && buf[1] === 0xd8;
  return ok ? { mime: m[1], data: m[2], bytes: buf.length } : null;
}

export type AddResult = { ok: true } | { ok: false; reason: string };

/** Only while the application can be edited: what a reviewer is looking at does not change under them. */
export async function addDocument(userId: string, kind: string, fileName: string, dataUrl: string): Promise<AddResult> {
  if (!DOCUMENT_KINDS.some((d) => d.id === kind)) return { ok: false, reason: "Choose what the document is." };
  const b = await db.get("SELECT id FROM provider_business WHERE user_id=? AND status IN ('draft','changes_requested')", userId) as { id: string } | undefined;
  if (!b) return { ok: false, reason: "Documents can only be added while your application is being prepared." };
  const file = parseDocument(dataUrl);
  if (!file) return { ok: false, reason: "Use a photo (JPEG or PNG) or a PDF of 3 MB or less." };
  const count = Number((await db.get("SELECT COUNT(*) AS n FROM business_document WHERE business_id=?", b.id) as { n: number }).n);
  if (count >= MAX_PER_BUSINESS) return { ok: false, reason: `You can add up to ${MAX_PER_BUSINESS} documents. Remove one first.` };
  const id = randomUUID();
  await db.run(`INSERT INTO business_document (id, business_id, kind, file_name, mime, data, size_bytes, uploaded_by, uploaded_at)
       VALUES (?,?,?,?,?,?,?,?,?)`, id, b.id, kind, fileName.replace(/[^\w .()-]/g, "").slice(0, 120) || "document", file.mime, file.data, file.bytes, userId, new Date().toISOString());
  await audit(userId, "business.document_added", b.id, kind);
  return { ok: true };
}

export async function removeDocument(userId: string, id: string): Promise<boolean> {
  const b = await db.get("SELECT id FROM provider_business WHERE user_id=? AND status IN ('draft','changes_requested')", userId) as { id: string } | undefined;
  if (!b) return false;
  const res = await db.run("DELETE FROM business_document WHERE id=? AND business_id=?", id, b.id);
  if (res.changes) await audit(userId, "business.document_removed", b.id);
  return res.changes > 0;
}

/** What is still missing before an application can go to review. */
export function missingDocuments(businessType: string, docs: Pick<BusinessDocument, "kind">[]): string[] {
  const out: string[] = [];
  if (!docs.some((d) => d.kind === "id")) out.push("ID of the person in charge");
  if (businessType === "company" && !docs.some((d) => d.kind === "registration")) out.push("Business registration certificate");
  return out;
}
