import type { FastifyInstance } from "fastify";
import { pool } from "../../db.js";
import { config } from "../../config.js";

type RetrieveBody = {
  query: string;
  chat_id?: string;
  label?: string;
  k_chat?: number;
  k_label?: number;
};

export async function registerRagRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/rag/stats", async () => {
    const [totals, byLabel, byChat, coverage] = await Promise.all([
      pool.query<{ embeddings: string }>(
        "SELECT COUNT(*)::text AS embeddings FROM message_embeddings"
      ),
      pool.query<{ label: string | null; embeddings: string; chats: string }>(
        `SELECT label,
                COUNT(*)::text AS embeddings,
                COUNT(DISTINCT chat_id)::text AS chats
         FROM message_embeddings
         GROUP BY label
         ORDER BY COUNT(*) DESC`
      ),
      pool.query<{
        chat_id: string;
        name: string | null;
        label: string | null;
        embeddings: string;
      }>(
        `SELECT e.chat_id,
                c.name,
                c.label,
                COUNT(*)::text AS embeddings
         FROM message_embeddings e
         LEFT JOIN chats c ON c.id = e.chat_id
         GROUP BY e.chat_id, c.name, c.label
         ORDER BY COUNT(*) DESC
         LIMIT 25`
      ),
      pool.query<{ messages: string; embedded: string }>(
        `SELECT
           (SELECT COUNT(*) FROM messages
            WHERE content IS NOT NULL AND length(trim(content)) > 0)::text AS messages,
           (SELECT COUNT(*) FROM message_embeddings)::text AS embedded`
      ),
    ]);

    return {
      total_embeddings: Number(totals.rows[0]?.embeddings ?? 0),
      by_label: byLabel.rows.map((r) => ({
        label: r.label,
        embeddings: Number(r.embeddings),
        chats: Number(r.chats),
      })),
      top_chats: byChat.rows.map((r) => ({
        chat_id: r.chat_id,
        name: r.name,
        label: r.label,
        embeddings: Number(r.embeddings),
      })),
      coverage: {
        messages_with_content: Number(coverage.rows[0]?.messages ?? 0),
        embedded: Number(coverage.rows[0]?.embedded ?? 0),
      },
    };
  });

  app.post<{ Body: RetrieveBody }>("/api/rag/retrieve", async (req, reply) => {
    if (!req.body?.query?.trim()) {
      reply.status(400);
      return { error: "query is required" };
    }
    const res = await fetch(`${config.aiServiceUrl}/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });
    if (!res.ok) {
      const text = await res.text();
      reply.status(res.status);
      return { error: text };
    }
    return res.json();
  });
}
