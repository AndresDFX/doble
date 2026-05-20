import type { FastifyInstance } from "fastify";
import { pool } from "../../db.js";
import { aiHealthcheck } from "../../ai-client.js";
import { waStatus } from "../../wa-status.js";

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    const [dbOk, aiOk] = await Promise.all([
      pool.query("SELECT 1").then(() => true).catch(() => false),
      aiHealthcheck(),
    ]);
    return {
      gateway: "ok",
      db: dbOk ? "ok" : "down",
      ai: aiOk ? "ok" : "down",
      wa: waStatus.get().connection,
      at: new Date().toISOString(),
    };
  });
}
