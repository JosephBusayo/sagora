/**
 * The HTML half of every email. Messages are written once, as plain text, and this dresses them:
 * the Sagora name on top, the text as paragraphs, links made clickable, a one-time code shown
 * large, and a short footer. A bare one-line message looks like spam to strict inboxes such as
 * iCloud; a plain-text copy is still sent alongside for clients that prefer it.
 *
 * Email clients ignore stylesheets and most modern CSS, so everything is inline and in tables.
 */

const BRAND = "#567621";
const TEXT = "#1d1d1b";
const MUTED = "#6d6e6b";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Escapes a line, then turns any web address in it into a link. */
const line = (s: string) =>
  escape(s).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:${BRAND};word-break:break-all">${url}</a>`);

const CODE = /^Your Sagora code is (\d+)$/;

export function emailHtml(text: string): string {
  const body = text.split(/\n{2,}/).map((para) => {
    const code = para.trim().match(CODE);
    if (code) {
      return `<p style="margin:0 0 8px;color:${TEXT}">Your Sagora code is</p>
<p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:6px;color:${TEXT}">${code[1]}</p>`;
    }
    return `<p style="margin:0 0 16px;color:${TEXT}">${para.split("\n").map(line).join("<br>")}</p>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f6f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f2">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px">
<tr><td style="padding:24px 28px 8px;font:700 22px Arial,Helvetica,sans-serif;color:${BRAND}">Sagora</td></tr>
<tr><td style="padding:8px 28px 12px;font:15px/22px Arial,Helvetica,sans-serif">
${body}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #ececec;font:12px/18px Arial,Helvetica,sans-serif;color:${MUTED}">
Sagora connects farmers in Sierra Leone with tractor and harvester providers.<br>
You are receiving this because of your Sagora account or request.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
