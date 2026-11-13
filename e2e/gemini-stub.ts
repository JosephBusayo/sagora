import http from "node:http";

/**
 * A stand-in for Gemini's generateContent endpoint, so the voice-note flow is tested end to end
 * without the network, an API key, or a real recording. It answers in Gemini's own shape, and can
 * be told to refuse or to stall so the screens for those cases can be tested too.
 */
export const GEMINI_STUB_PORT = 3498;

export type Mode = "ok" | "refuse" | "stall";

export function startGeminiStub() {
  let mode: Mode = "ok";
  const seen: { model: string; thinkingOff: boolean; mime: string }[] = [];
  // A stalled reply holds its socket open, which would keep the server from closing at the end
  // of the file. They are tracked so stopping can drop them.
  const stalled = new Set<ReturnType<typeof setTimeout>>();

  const answer = {
    transcript:
      "A want fo plough mi lan. Na tu acre. I de na Bo District, na Mongere village. A want di wok " +
      "fo bigin dis Satide. Mi nem na Sahr Konteh.",
    extracted: {
      service: "ploughing", acres: 2, district: "Bo", village: "Mongere",
      preferredDate: "2026-11-14", contactName: "Sahr Konteh", contactPhone: null,
    },
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", `http://localhost:${GEMINI_STUB_PORT}`);
      const model = url.pathname.match(/\/models\/([^:]+):generateContent/)?.[1] ?? "";
      const body = raw ? (JSON.parse(raw) as { contents: { parts: { inlineData?: { mimeType: string } }[] }[]; generationConfig?: { thinkingConfig?: unknown } }) : undefined;
      seen.push({
        model,
        thinkingOff: Boolean(body?.generationConfig?.thinkingConfig),
        mime: body?.contents?.[0]?.parts?.find((p) => p.inlineData)?.inlineData?.mimeType ?? "",
      });

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (!url.searchParams.get("key")) return send(400, { error: { message: "API key not valid" } });
      if (mode === "refuse") return send(400, { error: { message: "stub refusing on purpose" } });
      // Longer than the 45s Gemini is given, so the request is abandoned rather than answered.
      if (mode === "stall") return void stalled.add(setTimeout(() => send(200, {}), 60_000));

      return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP" }] });
    });
  });

  return {
    answer,
    seen,
    set: (m: Mode) => { mode = m; },
    start: () => new Promise<void>((r) => server.listen(GEMINI_STUB_PORT, "127.0.0.1", r)),
    stop: () => new Promise<void>((r) => {
      for (const t of stalled) clearTimeout(t);
      stalled.clear();
      server.closeAllConnections();
      server.close(() => r());
    }),
  };
}
