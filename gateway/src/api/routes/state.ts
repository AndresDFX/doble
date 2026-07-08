import type { FastifyInstance } from "fastify";
import { container } from "../../composition/container.js";

type StatePatch = {
  enabled?: boolean;
  draft_mode?: boolean;
  user_name?: string;
  global_prompt?: string;
  exclude_patterns?: string;
};

export async function registerStateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/state", async () => container.agentState.get());

  app.patch<{ Body: StatePatch }>("/api/state", async (req, reply) => {
    const { enabled, draft_mode, user_name, global_prompt, exclude_patterns } = req.body ?? {};
    if (
      enabled === undefined &&
      draft_mode === undefined &&
      user_name === undefined &&
      global_prompt === undefined &&
      exclude_patterns === undefined
    ) {
      reply.status(400);
      return { error: "no fields to update" };
    }
    const state = await container.agentState.patch({
      enabled,
      draft_mode,
      user_name,
      global_prompt,
      exclude_patterns,
    });
    // Saving exclusion patterns applies them right away to existing chats; the
    // response carries how many got excluded so the UI can report it.
    if (exclude_patterns !== undefined) {
      const excluded = await container.chats.applyExcludePatterns(exclude_patterns);
      return { ...state, excluded };
    }
    return state;
  });
}
