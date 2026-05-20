import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { registerStateRoutes } from "./routes/state.js";
import { registerChatRoutes } from "./routes/chats.js";
import { registerDraftRoutes } from "./routes/drafts.js";
import { registerLabelRoutes } from "./routes/labels.js";
import { registerWaRoutes } from "./routes/wa.js";
import { registerEventsRoute } from "./routes/events.js";
import { registerHealthRoute } from "./routes/health.js";

export async function startApiServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true, credentials: true });

  await registerHealthRoute(app);
  await registerStateRoutes(app);
  await registerChatRoutes(app);
  await registerDraftRoutes(app);
  await registerLabelRoutes(app);
  await registerWaRoutes(app);
  await registerEventsRoute(app);

  app.setErrorHandler((err, req, reply) => {
    logger.error({ err, url: req.url, method: req.method }, "API error");
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({ error: err.message });
  });

  await app.listen({ port: config.gatewayPort, host: "0.0.0.0" });
  logger.info({ port: config.gatewayPort }, "Admin API listening");
  return app;
}
