import type { FastifyInstance } from "fastify";
import { pool } from "../../db.js";

type ChatPatch = { label?: string | null; agent_enabled?: boolean };

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { label?: string; q?: string; limit?: string; offset?: string };
  }>("/api/chats", async (req) => {
    const { label, q, limit = "100", offset = "0" } = req.query;
    const where: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (label) {
      where.push(`c.label = $${i++}`);
      values.push(label);
    }
    if (q) {
      where.push(`(c.name ILIKE $${i} OR c.id ILIKE $${i})`);
      values.push(`%${q}%`);
      i++;
    }
    values.push(Number(limit), Number(offset));
    const sql = `
      SELECT c.id, c.name, c.label, c.agent_enabled,
             COALESCE(stats.msgs, 0) AS msgs,
             stats.last_ts
      FROM chats c
      LEFT JOIN (
        SELECT chat_id, COUNT(*) AS msgs, MAX(ts) AS last_ts
        FROM messages GROUP BY chat_id
      ) stats ON stats.chat_id = c.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY stats.last_ts DESC NULLS LAST
      LIMIT $${i++} OFFSET $${i++}
    `;
    const { rows } = await pool.query(sql, values);
    return rows;
  });

  app.get<{ Params: { id: string } }>("/api/chats/:id", async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.label, c.agent_enabled,
              COALESCE(stats.msgs, 0) AS msgs, stats.last_ts
       FROM chats c
       LEFT JOIN (
         SELECT chat_id, COUNT(*) AS msgs, MAX(ts) AS last_ts
         FROM messages WHERE chat_id = $1 GROUP BY chat_id
       ) stats ON stats.chat_id = c.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      reply.status(404);
      return { error: "chat not found" };
    }
    return rows[0];
  });

  app.patch<{ Params: { id: string }; Body: ChatPatch }>(
    "/api/chats/:id",
    async (req, reply) => {
      const { label, agent_enabled } = req.body ?? {};
      if (label === undefined && agent_enabled === undefined) {
        reply.status(400);
        return { error: "no fields to update" };
      }
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (label !== undefined) {
        sets.push(`label = $${i++}`);
        values.push(label);
      }
      if (agent_enabled !== undefined) {
        sets.push(`agent_enabled = $${i++}`);
        values.push(agent_enabled);
      }
      values.push(req.params.id);
      await pool.query(
        `UPDATE chats SET ${sets.join(", ")} WHERE id = $${i}`,
        values
      );
      return { ok: true };
    }
  );

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; before?: string };
  }>("/api/chats/:id/messages", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? "50"), 500);
    const before = req.query.before;
    const where = ["chat_id = $1"];
    const values: unknown[] = [req.params.id];
    if (before) {
      where.push("ts < $2");
      values.push(new Date(before));
    }
    values.push(limit);
    const sql = `
      SELECT id, chat_id, from_me, type, content, ts
      FROM messages
      WHERE ${where.join(" AND ")}
      ORDER BY ts DESC
      LIMIT $${values.length}
    `;
    const { rows } = await pool.query(sql, values);
    return rows;
  });
}
