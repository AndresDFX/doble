import type { FastifyInstance } from "fastify";
import { container } from "../../composition/container.js";

type RetrieveBody = {
  query: string;
  chat_id?: string;
  label?: string;
  k_chat?: number;
  k_label?: number;
};

export async function registerRagRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/rag/stats", async () => container.rag.stats());

  app.post<{ Body: RetrieveBody }>("/api/rag/retrieve", async (req, reply) => {
    if (!req.body?.query?.trim()) {
      reply.status(400);
      return { error: "query is required" };
    }
    const result = await container.rag.retrieve(req.body);
    if (!result.ok) {
      reply.status(result.status);
      return { error: result.error };
    }
    return result.data;
  });
}
