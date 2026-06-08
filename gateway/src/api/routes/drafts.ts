import type { FastifyInstance } from "fastify";
import { container } from "../../composition/container.js";

type DraftPatch = { status?: "approved" | "discarded"; content?: string };

export async function registerDraftRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { status?: string; chat_id?: string; limit?: string } }>(
    "/api/drafts",
    async (req) =>
      container.drafts.list({
        status: req.query.status,
        chatId: req.query.chat_id,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      })
  );

  app.patch<{ Params: { id: string }; Body: DraftPatch }>(
    "/api/drafts/:id",
    async (req, reply) => {
      const { status, content } = req.body ?? {};
      if (!status && content === undefined) {
        reply.status(400);
        return { error: "no fields to update" };
      }
      await container.drafts.patch(Number(req.params.id), { status, content });
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string } }>("/api/drafts/:id/send", async (req, reply) => {
    const result = await container.drafts.send(Number(req.params.id));
    if (!result.ok) {
      reply.status(result.status);
      return { error: result.error };
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/drafts/:id", async (req) => {
    await container.drafts.delete(Number(req.params.id));
    return { ok: true };
  });
}
