import "server-only";

/**
 * A one-page PDF, written by hand. Everything on an invoice is text in a built-in PDF font, and
 * that is about forty lines of format, which is cheaper to keep than a dependency.
 *
 * Helvetica here covers Latin-1 only, so anything outside it becomes "?" rather than breaking
 * the file.
 */

export type InvoiceLine = { label: string; value: string };

const escapeText = (s: string) =>
  s.replace(/[^\x20-\xff]/g, "?").replace(/([\\()])/g, "\\$1");

export function invoicePdf({ title, lines, footer }: { title: string; lines: InvoiceLine[]; footer: string[] }): Buffer {
  const left = 56;
  const valueAt = 220;
  let y = 770;
  const text = (x: number, size: number, value: string, font = "F1") =>
    `BT /${font} ${size} Tf ${x} ${y} Td (${escapeText(value)}) Tj ET`;

  const ops = [text(left, 20, title, "F2")];
  y -= 40;
  for (const line of lines) {
    ops.push(text(left, 11, line.label), text(valueAt, 11, line.value, "F2"));
    y -= 22;
  }
  y -= 14;
  for (const line of footer) {
    ops.push(text(left, 9, line));
    y -= 14;
  }
  const stream = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
