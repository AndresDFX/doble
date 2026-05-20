import type { FastifyInstance } from "fastify";
import { bus, type AppEvent } from "../../events.js";
import { waStatus } from "../../wa-status.js";
import { senderStatus } from "../../sender/status.js";
import { getBatchState } from "../../sender/batch.js";
import { logger } from "../../logger.js";

export async function registerEventsRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(":ok\n\n");

    const sendEvent = (event: AppEvent) => {
      try {
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event.payload)}\n\n`);
      } catch (err) {
        logger.warn({ err }, "SSE write failed");
      }
    };

    sendEvent({ type: "wa-status", payload: waStatus.get() });
    sendEvent({ type: "sender-status", payload: senderStatus.get() });
    const batch = getBatchState();
    sendEvent({
      type: "batch-state",
      payload: {
        batchId: batch.id,
        status: batch.status,
        total: batch.total,
        sent: batch.sent,
        failed: batch.failed,
      },
    });

    const onEvent = (event: AppEvent) => sendEvent(event);
    bus.on("event", onEvent);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(":hb\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      bus.off("event", onEvent);
      logger.debug("SSE client disconnected");
    });
  });
}
