import { startBaileys } from "./baileys.js";
import { aiHealthcheck } from "./ai-client.js";
import { pool } from "./db.js";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { startApiServer } from "./api/server.js";
import { container } from "./composition/container.js";
import { startProactiveScheduler } from "./application/proactive-messenger.js";
import { applySchema } from "./infrastructure/migrate.js";
import { startKeepAlive } from "./infrastructure/keep-alive.js";

async function main() {
  logger.info("Doble gateway starting");

  try {
    await pool.query("SELECT 1");
    logger.info("Postgres connection OK");
  } catch (err) {
    logger.fatal({ err }, "Cannot connect to Postgres — check DATABASE_URL");
    process.exit(1);
  }

  // Self-heal the schema (idempotent) before anything queries it.
  if (config.autoMigrate) {
    await applySchema();
  }

  const aiOk = await aiHealthcheck();
  if (!aiOk) {
    logger.warn(
      "AI service is not reachable — gateway will start anyway, but replies will fail until it's up"
    );
  }

  await startApiServer();
  await startBaileys();

  if (config.proactiveSchedulerEnabled) {
    startProactiveScheduler(container.proactive, logger, { tickMs: config.proactiveTickMs });
  } else {
    logger.info("Proactive scheduler disabled (PROACTIVE_SCHEDULER=off)");
  }

  // Anti-sleep en free tier: auto-ping por la URL pública (no-op sin URL, p. ej. local).
  if (config.keepAliveUrl) {
    startKeepAlive(logger, { url: config.keepAliveUrl, intervalMs: config.keepAliveIntervalMs });
  }
}

process.on("SIGINT", async () => {
  logger.info("SIGINT received — shutting down");
  await pool.end().catch(() => {});
  process.exit(0);
});

main().catch((err) => {
  logger.fatal({ err }, "Fatal error in gateway");
  process.exit(1);
});
