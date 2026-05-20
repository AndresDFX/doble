import type { FastifyInstance } from "fastify";
import { activity, type ActivityKind } from "../../activity.js";

export async function registerActivityRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string; kind?: ActivityKind } }>(
    "/api/activity",
    async (req) => {
      const limit = Math.min(Number(req.query.limit ?? "200"), 500);
      return activity.list(limit, req.query.kind);
    }
  );

  app.delete("/api/activity", async () => {
    activity.clear();
    return { ok: true };
  });
}
