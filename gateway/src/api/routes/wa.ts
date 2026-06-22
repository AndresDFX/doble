import type { FastifyInstance } from "fastify";
import { waStatus } from "../../wa-status.js";
import { relinkWhatsApp } from "../../baileys.js";

export async function registerWaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/wa/status", async () => {
    return waStatus.get();
  });

  // Force a re-pair: wipe the session and restart so the UI shows a new QR.
  // Used when the connection is stuck (e.g. after unlinking the device).
  // Fire-and-forget: the new QR / status arrives via SSE and the status poll.
  app.post("/api/wa/relink", async () => {
    void relinkWhatsApp().catch((err) => app.log.error({ err }, "relink failed"));
    return { ok: true };
  });
}
