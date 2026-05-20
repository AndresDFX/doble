import type { FastifyInstance } from "fastify";
import { pool } from "../../db.js";

type StatePatch = {
  enabled?: boolean;
  draft_mode?: boolean;
  user_name?: string;
};

export async function registerStateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/state", async () => {
    const { rows } = await pool.query(
      "SELECT enabled, draft_mode, user_name FROM agent_state WHERE id = 1"
    );
    return rows[0];
  });

  app.patch<{ Body: StatePatch }>("/api/state", async (req, reply) => {
    const { enabled, draft_mode, user_name } = req.body ?? {};
    if (
      enabled === undefined &&
      draft_mode === undefined &&
      user_name === undefined
    ) {
      reply.status(400);
      return { error: "no fields to update" };
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (enabled !== undefined) {
      sets.push(`enabled = $${i++}`);
      values.push(enabled);
    }
    if (draft_mode !== undefined) {
      sets.push(`draft_mode = $${i++}`);
      values.push(draft_mode);
    }
    if (user_name !== undefined) {
      sets.push(`user_name = $${i++}`);
      values.push(user_name);
    }
    await pool.query(
      `UPDATE agent_state SET ${sets.join(", ")} WHERE id = 1`,
      values
    );
    const { rows } = await pool.query(
      "SELECT enabled, draft_mode, user_name FROM agent_state WHERE id = 1"
    );
    return rows[0];
  });
}
