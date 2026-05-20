import type { FastifyInstance } from "fastify";
import { waStatus } from "../../wa-status.js";

export async function registerWaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/wa/status", async () => {
    return waStatus.get();
  });
}
