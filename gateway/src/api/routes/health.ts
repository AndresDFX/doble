import type { FastifyInstance } from "fastify";
import { container } from "../../composition/container.js";

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => container.health.snapshot());
}
