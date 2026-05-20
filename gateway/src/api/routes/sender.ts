import type { FastifyInstance } from "fastify";
import { senderStatus } from "../../sender/status.js";
import { startSender, stopSender, purgeSenderSession } from "../../sender/session.js";
import { readCatalog, catalogSummary } from "../../sender/catalog.js";
import { startBatch, getBatchState, abortCurrentBatch, type BatchSpec } from "../../sender/batch.js";

export async function registerSenderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/sender/status", async () => {
    return senderStatus.get();
  });

  app.post("/api/sender/connect", async () => {
    startSender().catch(() => {});
    return senderStatus.get();
  });

  app.post("/api/sender/disconnect", async () => {
    await stopSender();
    return senderStatus.get();
  });

  app.delete("/api/sender/session", async () => {
    await purgeSenderSession();
    return senderStatus.get();
  });

  app.get("/api/sender/catalog", async () => {
    const catalog = await readCatalog();
    return catalogSummary(catalog);
  });

  app.get("/api/sender/batch", async () => {
    return getBatchState();
  });

  app.post<{ Body: Partial<BatchSpec> }>("/api/sender/batch", async (req, reply) => {
    const body = req.body ?? {};
    if (!body.to) {
      reply.status(400);
      return { error: "to is required" };
    }
    try {
      const state = await startBatch({
        to: body.to,
        themes: body.themes ?? null,
        count: body.count ?? null,
        minDelayMs: body.minDelayMs ?? 6000,
        maxDelayMs: body.maxDelayMs ?? 15000,
        dry: !!body.dry,
      });
      return state;
    } catch (err) {
      const message = (err as Error).message;
      reply.status(409);
      return { error: message };
    }
  });

  app.delete("/api/sender/batch", async () => {
    const aborted = abortCurrentBatch();
    return { aborted };
  });
}
