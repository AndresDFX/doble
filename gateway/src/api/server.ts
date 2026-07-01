import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { registerStateRoutes } from "./routes/state.js";
import { registerChatRoutes } from "./routes/chats.js";
import { registerDraftRoutes } from "./routes/drafts.js";
import { registerLabelRoutes } from "./routes/labels.js";
import { registerWaRoutes } from "./routes/wa.js";
import { registerEventsRoute } from "./routes/events.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerActivityRoute } from "./routes/activity.js";
import { registerSenderRoutes } from "./routes/sender.js";
import { registerRagRoutes } from "./routes/rag.js";
import { registerOwnerNotesRoutes } from "./routes/owner-notes.js";
import { registerBasicAuth, registerFrontend } from "./hosting.js";

export async function startApiServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Tolerate an EMPTY body on application/json requests. The dashboard sends
  // several bodyless POST/DELETE calls (e.g. POST /api/wa/relink) with a JSON
  // content-type; Fastify's default parser 400s those ("Body cannot be empty
  // when content-type is set to 'application/json'"). Treat empty as no body.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const text = (body as string).trim();
      if (text.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch {
        const err = new Error("Invalid JSON body") as Error & { statusCode?: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    }
  );

  await app.register(cors, { origin: true, credentials: true });
  registerBasicAuth(app);
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  await registerHealthRoute(app);
  await registerStateRoutes(app);
  await registerChatRoutes(app);
  await registerDraftRoutes(app);
  await registerLabelRoutes(app);
  await registerWaRoutes(app);
  await registerActivityRoute(app);
  await registerSenderRoutes(app);
  await registerRagRoutes(app);
  await registerOwnerNotesRoutes(app);
  await registerEventsRoute(app);

  // Optionally serve the built SPA same-origin (Render single service). Must be
  // last so the SPA fallback never shadows the /api routes registered above.
  await registerFrontend(app);

  app.setErrorHandler((err, req, reply) => {
    logger.error({ err, url: req.url, method: req.method }, "API error");
    const e = err as { statusCode?: number; message?: string };
    reply.status(e.statusCode ?? 500).send({ error: e.message ?? "Internal error" });
  });

  await app.listen({ port: config.gatewayPort, host: "0.0.0.0" });
  logger.info({ port: config.gatewayPort }, "Admin API listening");
  return app;
}
