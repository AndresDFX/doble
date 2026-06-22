/**
 * Public-hosting concerns for the gateway: a Basic Auth gate over the admin API
 * + dashboard, and (optionally) serving the built frontend same-origin.
 *
 * Both are only relevant when the gateway is exposed on a public URL (Render).
 * Locally / in docker-compose they stay off: no ADMIN_PASSWORD means open, and
 * nginx serves the frontend, so FRONTEND_DIST is unset.
 */
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { logger } from "../logger.js";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Gate every request behind HTTP Basic Auth when ADMIN_PASSWORD is set. The
 * health endpoint stays open for platform healthchecks + keep-alive pings, and
 * CORS preflights pass through. Same-origin browsers replay the cached
 * credentials on fetch + EventSource (SSE), so one prompt covers the dashboard.
 */
export function registerBasicAuth(app: FastifyInstance): void {
  if (!config.adminPassword) {
    logger.warn(
      "ADMIN_PASSWORD not set — admin API + dashboard are UNAUTHENTICATED (ok for local dev only)"
    );
    return;
  }
  const expected =
    "Basic " +
    Buffer.from(`${config.adminUser}:${config.adminPassword}`).toString("base64");

  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS") return; // let CORS preflight through
    const url = req.url.split("?")[0];
    if (url === "/api/health") return; // open for healthcheck / keep-alive
    if (!safeEqual(req.headers.authorization ?? "", expected)) {
      reply
        .header("WWW-Authenticate", 'Basic realm="Doble", charset="UTF-8"')
        .code(401)
        .send({ error: "Unauthorized" });
    }
  });
  logger.info("Basic Auth enabled on the admin API + dashboard");
}

/**
 * Serve the built frontend (SPA) from FRONTEND_DIST, same-origin as /api, with
 * a history-fallback to index.html. No-op when FRONTEND_DIST is unset.
 */
export async function registerFrontend(app: FastifyInstance): Promise<void> {
  if (!config.frontendDist) return;
  const root = path.resolve(config.frontendDist);
  await app.register(fastifyStatic, { root, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url && req.raw.url.startsWith("/api")) {
      reply.code(404).send({ error: "Not found" });
      return;
    }
    reply.sendFile("index.html");
  });
  logger.info({ root }, "Serving frontend (SPA) from the gateway");
}
