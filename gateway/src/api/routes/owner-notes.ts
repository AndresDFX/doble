import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { pool } from "../../db.js";
import { config } from "../../config.js";
import { aiTranscribe, aiEmbedAndStore } from "../../ai-client.js";
import { ensureOwnerChat, OWNER_CHAT_ID, OWNER_LABEL } from "../../owner.js";
import { bus } from "../../events.js";
import { activity } from "../../activity.js";
import { logger } from "../../logger.js";

type CreateBody = {
  content: string;
  raw_media_path?: string | null;
};

type PatchBody = {
  content: string;
};

const ACCEPTED_AUDIO = /^(audio|video)\//i;

export async function registerOwnerNotesRoutes(app: FastifyInstance): Promise<void> {
  await ensureOwnerChat();

  app.get("/api/owner-notes", async () => {
    await ensureOwnerChat();
    const { rows } = await pool.query(
      `SELECT m.id, m.content, m.raw_media_path, m.ts,
              EXISTS(SELECT 1 FROM message_embeddings WHERE message_id = m.id) AS embedded
       FROM messages m
       WHERE m.chat_id = $1
       ORDER BY m.ts DESC`,
      [OWNER_CHAT_ID]
    );
    return rows;
  });

  app.post("/api/owner-notes/transcribe", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      reply.status(400);
      return { error: "no file uploaded" };
    }
    if (!ACCEPTED_AUDIO.test(file.mimetype)) {
      reply.status(400);
      return { error: `unsupported mime type: ${file.mimetype}` };
    }

    await mkdir(config.waMediaDir, { recursive: true });
    const ext = extname(file.filename || "") || mimeToExt(file.mimetype);
    const filename = `owner-${randomUUID()}${ext}`;
    const path = join(config.waMediaDir, filename);
    const buf = await file.toBuffer();
    await writeFile(path, buf);

    activity.push({
      kind: "system",
      level: "info",
      message: `Audio recibido para transcripción (${(buf.length / 1024).toFixed(1)} KB)`,
      meta: { mime: file.mimetype, filename: file.filename },
    });

    try {
      const text = await aiTranscribe(path);
      activity.push({
        kind: "ai",
        level: "success",
        message: `Audio transcrito (${text.length} caracteres)`,
        meta: { preview: text.slice(0, 80) },
      });
      return { text, raw_media_path: path };
    } catch (err) {
      const msg = (err as Error).message;
      activity.push({ kind: "ai", level: "error", message: `Transcripción falló: ${msg}` });
      reply.status(502);
      return { error: msg };
    }
  });

  app.post<{ Body: CreateBody }>("/api/owner-notes", async (req, reply) => {
    await ensureOwnerChat();
    const content = req.body?.content?.trim();
    if (!content) {
      reply.status(400);
      return { error: "content is required" };
    }
    const id = randomUUID();
    const ts = new Date();
    await pool.query(
      `INSERT INTO messages (id, chat_id, from_me, type, content, raw_media_path, ts)
       VALUES ($1, $2, TRUE, 'note', $3, $4, $5)`,
      [id, OWNER_CHAT_ID, content, req.body.raw_media_path ?? null, ts]
    );
    bus.publish({
      type: "message",
      payload: {
        id,
        chat_id: OWNER_CHAT_ID,
        from_me: true,
        content,
        ts: ts.toISOString(),
      },
    });
    activity.push({
      kind: "system",
      level: "success",
      message: `Nota del dueño guardada (${content.length} chars)`,
      meta: { id, preview: content.slice(0, 80) },
    });

    try {
      await aiEmbedAndStore({
        message_id: id,
        chat_id: OWNER_CHAT_ID,
        label: OWNER_LABEL,
        content,
      });
      activity.push({
        kind: "ai",
        level: "success",
        message: `Nota embedded en pgvector`,
        meta: { id },
      });
    } catch (err) {
      logger.error({ err, id }, "Failed to embed owner note");
      activity.push({
        kind: "ai",
        level: "error",
        message: `No se pudo embedder la nota: ${(err as Error).message}`,
        meta: { id },
      });
    }

    return { id, content, ts: ts.toISOString() };
  });

  app.patch<{ Params: { id: string }; Body: PatchBody }>(
    "/api/owner-notes/:id",
    async (req, reply) => {
      const content = req.body?.content?.trim();
      if (!content) {
        reply.status(400);
        return { error: "content is required" };
      }
      const { rowCount } = await pool.query(
        `UPDATE messages SET content = $1 WHERE id = $2 AND chat_id = $3`,
        [content, req.params.id, OWNER_CHAT_ID]
      );
      if (rowCount === 0) {
        reply.status(404);
        return { error: "note not found" };
      }
      try {
        await aiEmbedAndStore({
          message_id: req.params.id,
          chat_id: OWNER_CHAT_ID,
          label: OWNER_LABEL,
          content,
        });
        activity.push({
          kind: "system",
          level: "info",
          message: `Nota ${req.params.id.slice(0, 8)} editada y re-embedded`,
        });
      } catch (err) {
        activity.push({
          kind: "ai",
          level: "warn",
          message: `Nota editada pero re-embedding falló: ${(err as Error).message}`,
        });
      }
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>("/api/owner-notes/:id", async (req, reply) => {
    const { rowCount } = await pool.query(
      `DELETE FROM messages WHERE id = $1 AND chat_id = $2`,
      [req.params.id, OWNER_CHAT_ID]
    );
    if (rowCount === 0) {
      reply.status(404);
      return { error: "note not found" };
    }
    activity.push({
      kind: "system",
      level: "warn",
      message: `Nota ${req.params.id.slice(0, 8)} eliminada`,
    });
    return { ok: true };
  });
}

function mimeToExt(mime: string): string {
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("wav")) return ".wav";
  return ".bin";
}
