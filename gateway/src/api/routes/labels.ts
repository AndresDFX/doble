import type { FastifyInstance } from "fastify";
import { pool } from "../../db.js";

type LabelBody = {
  label: string;
  prompt_template: string;
  temperature: number;
};

type LabelPatch = {
  prompt_template?: string;
  temperature?: number;
};

export async function registerLabelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/labels", async () => {
    const { rows } = await pool.query(
      `SELECT lc.label, lc.prompt_template, lc.temperature,
              COALESCE(stats.chats, 0) AS chats
       FROM labels_config lc
       LEFT JOIN (
         SELECT label, COUNT(*) AS chats FROM chats WHERE label IS NOT NULL GROUP BY label
       ) stats ON stats.label = lc.label
       ORDER BY lc.label`
    );
    return rows;
  });

  app.post<{ Body: LabelBody }>("/api/labels", async (req, reply) => {
    const { label, prompt_template, temperature } = req.body;
    if (!label || !prompt_template) {
      reply.status(400);
      return { error: "label and prompt_template required" };
    }
    await pool.query(
      `INSERT INTO labels_config (label, prompt_template, temperature)
       VALUES ($1, $2, $3)
       ON CONFLICT (label) DO UPDATE SET
         prompt_template = EXCLUDED.prompt_template,
         temperature = EXCLUDED.temperature`,
      [label, prompt_template, temperature ?? 0.7]
    );
    return { ok: true };
  });

  app.patch<{ Params: { label: string }; Body: LabelPatch }>(
    "/api/labels/:label",
    async (req, reply) => {
      const { prompt_template, temperature } = req.body ?? {};
      if (prompt_template === undefined && temperature === undefined) {
        reply.status(400);
        return { error: "no fields to update" };
      }
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (prompt_template !== undefined) {
        sets.push(`prompt_template = $${i++}`);
        values.push(prompt_template);
      }
      if (temperature !== undefined) {
        sets.push(`temperature = $${i++}`);
        values.push(temperature);
      }
      values.push(req.params.label);
      await pool.query(
        `UPDATE labels_config SET ${sets.join(", ")} WHERE label = $${i}`,
        values
      );
      return { ok: true };
    }
  );

  app.delete<{ Params: { label: string } }>(
    "/api/labels/:label",
    async (req, reply) => {
      if (req.params.label === "default") {
        reply.status(400);
        return { error: "cannot delete the 'default' label" };
      }
      const used = await pool.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM chats WHERE label = $1",
        [req.params.label]
      );
      if (Number(used.rows[0]?.count ?? "0") > 0) {
        reply.status(409);
        return { error: "label in use by chats; reassign first" };
      }
      await pool.query("DELETE FROM labels_config WHERE label = $1", [req.params.label]);
      return { ok: true };
    }
  );
}
