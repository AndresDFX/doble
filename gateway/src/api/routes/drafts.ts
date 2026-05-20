import type { FastifyInstance } from "fastify";
import { pool } from "../../db.js";
import { getSock } from "../../baileys.js";
import { sendText } from "../../handlers/outgoing.js";

type DraftPatch = { status?: "approved" | "discarded"; content?: string };

export async function registerDraftRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { status?: string; chat_id?: string; limit?: string } }>(
    "/api/drafts",
    async (req) => {
      const { status = "pending", chat_id, limit = "100" } = req.query;
      const where: string[] = ["status = $1"];
      const values: unknown[] = [status];
      let i = 2;
      if (chat_id) {
        where.push(`chat_id = $${i++}`);
        values.push(chat_id);
      }
      values.push(Number(limit));
      const sql = `
        SELECT d.id, d.chat_id, d.reply_to_id, d.content, d.status,
               d.created_at, d.sent_at,
               c.name AS chat_name, c.label AS chat_label
        FROM drafts d
        LEFT JOIN chats c ON c.id = d.chat_id
        WHERE ${where.join(" AND ")}
        ORDER BY d.created_at DESC
        LIMIT $${i}
      `;
      const { rows } = await pool.query(sql, values);
      return rows;
    }
  );

  app.patch<{ Params: { id: string }; Body: DraftPatch }>(
    "/api/drafts/:id",
    async (req, reply) => {
      const { status, content } = req.body ?? {};
      if (!status && content === undefined) {
        reply.status(400);
        return { error: "no fields to update" };
      }
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (status) {
        sets.push(`status = $${i++}`);
        values.push(status);
      }
      if (content !== undefined) {
        sets.push(`content = $${i++}`);
        values.push(content);
      }
      values.push(Number(req.params.id));
      await pool.query(
        `UPDATE drafts SET ${sets.join(", ")} WHERE id = $${i}`,
        values
      );
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/drafts/:id/send",
    async (req, reply) => {
      const { rows } = await pool.query<{ id: number; chat_id: string; content: string; status: string }>(
        "SELECT id, chat_id, content, status FROM drafts WHERE id = $1",
        [Number(req.params.id)]
      );
      const draft = rows[0];
      if (!draft) {
        reply.status(404);
        return { error: "draft not found" };
      }
      if (draft.status === "sent") {
        reply.status(409);
        return { error: "already sent" };
      }
      const sock = getSock();
      const chatRow = await pool.query<{ label: string | null }>(
        "SELECT label FROM chats WHERE id = $1",
        [draft.chat_id]
      );
      await sendText(sock, draft.chat_id, draft.content, chatRow.rows[0]?.label ?? null);
      await pool.query(
        "UPDATE drafts SET status = 'sent', sent_at = NOW() WHERE id = $1",
        [draft.id]
      );
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/drafts/:id",
    async (req) => {
      await pool.query("DELETE FROM drafts WHERE id = $1", [Number(req.params.id)]);
      return { ok: true };
    }
  );
}
