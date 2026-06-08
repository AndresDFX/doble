import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { config } from "../../config.js";
import { container } from "../../composition/container.js";
import { activity } from "../../activity.js";

type CreateBody = { content: string; raw_media_path?: string | null };
type PatchBody = { content: string };

const ACCEPTED_AUDIO = /^(audio|video)\//i;

export async function registerOwnerNotesRoutes(app: FastifyInstance): Promise<void> {
  await container.ownerNotes.ensureOwnerChat();

  app.get("/api/owner-notes", async () => {
    await container.ownerNotes.ensureOwnerChat();
    return container.ownerNotes.list();
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
      const text = await container.ownerNotes.transcribe(path);
      return { text, raw_media_path: path };
    } catch (err) {
      const msg = (err as Error).message;
      activity.push({ kind: "ai", level: "error", message: `Transcripción falló: ${msg}` });
      reply.status(502);
      return { error: msg };
    }
  });

  app.post<{ Body: CreateBody }>("/api/owner-notes", async (req, reply) => {
    const content = req.body?.content?.trim();
    if (!content) {
      reply.status(400);
      return { error: "content is required" };
    }
    return container.ownerNotes.create({ content, raw_media_path: req.body.raw_media_path ?? null });
  });

  app.patch<{ Params: { id: string }; Body: PatchBody }>(
    "/api/owner-notes/:id",
    async (req, reply) => {
      const content = req.body?.content?.trim();
      if (!content) {
        reply.status(400);
        return { error: "content is required" };
      }
      const result = await container.ownerNotes.update(req.params.id, content);
      if (!result.ok) {
        reply.status(result.status);
        return { error: result.error };
      }
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>("/api/owner-notes/:id", async (req, reply) => {
    const result = await container.ownerNotes.remove(req.params.id);
    if (!result.ok) {
      reply.status(result.status);
      return { error: result.error };
    }
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
