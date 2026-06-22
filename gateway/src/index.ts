import { startBaileys } from "./baileys.js";
import { aiHealthcheck } from "./ai-client.js";
import { pool } from "./db.js";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { startApiServer } from "./api/server.js";
import { container } from "./composition/container.js";
import { startProactiveScheduler } from "./application/proactive-messenger.js";

async function main() {
  logger.info("Doble gateway starting");

  try {
    await pool.query("SELECT 1");
    logger.info("Postgres connection OK");
  } catch (err) {
    logger.fatal({ err }, "Cannot connect to Postgres — is docker compose up?");
    process.exit(1);
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
