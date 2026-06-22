import type { FastifyInstance } from "fastify";
import { container } from "../../composition/container.js";

type StatePatch = {
  enabled?: boolean;
  draft_mode?: boolean;
  user_name?: string;
  global_prompt?: string;
};

export async function registerStateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/state", async () => container.agentState.get());

  app.patch<{ Body: StatePatch }>("/api/state", async (req, reply) => {
    const { enabled, draft_mode, user_name, global_prompt } = req.body ?? {};
    if (
      enabled === undefined &&
      draft_mode === undefined &&
      user_name === undefined &&
      global_prompt === undefined
    ) {
      reply.status(400);
      return { error: "no fields to update" };
    }
    return container.agentState.patch({ enabled, draft_mode, user_name, global_prompt });
  });
}
