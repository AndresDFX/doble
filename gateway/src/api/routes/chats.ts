import type { FastifyInstance } from "fastify";
import { container } from "../../composition/container.js";

type ChatPatch = { label?: string | null; agent_enabled?: boolean };

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { label?: string; q?: string; limit?: string; offset?: string };
  }>("/api/chats", async (req) => {
    const { label, q, limit, offset } = req.query;
    return container.chats.list({
      label,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  });

  app.get<{ Params: { id: string } }>("/api/chats/:id", async (req, reply) => {
    const chat = await container.chats.get(req.params.id);
    if (!chat) {
      reply.status(404);
      return { error: "chat not found" };
    }
    return chat;
  });

  app.patch<{ Params: { id: string }; Body: ChatPatch }>(
    "/api/chats/:id",
    async (req, reply) => {
      const { label, agent_enabled } = req.body ?? {};
      if (label === undefined && agent_enabled === undefined) {
        reply.status(400);
        return { error: "no fields to update" };
      }
      await container.chats.patch(req.params.id, { label, agent_enabled });
      return { ok: true };
    }
  );

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; before?: string };
  }>("/api/chats/:id/messages", async (req) =>
    container.chats.listMessages({
      chatId: req.params.id,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      before: req.query.before,
    })
  );
}
