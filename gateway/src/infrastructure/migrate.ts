/**
 * Startup auto-migrate.
 *
 * There is no separate migration runner: `db/init.sql` is the single source of
 * schema truth and every statement in it is idempotent (CREATE … IF NOT EXISTS,
 * ALTER … ADD COLUMN IF NOT EXISTS, INSERT … ON CONFLICT DO NOTHING). Running it
 * on every boot makes a managed DB (Supabase/Neon) self-heal after a deploy that
 * added columns — without it, each schema change needs manual ALTERs on the
 * remote DB and the app crashes querying columns that don't exist yet.
 *
 * Safe to run every boot: it never drops or rewrites data. Best-effort: a
 * failure is logged, not fatal (the schema may already be current).
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// gateway/src/infrastructure -> repo root (or /app in the Render image) is 3 up.
const DEFAULT_INIT_SQL = resolve(__dirname, "../../../db/init.sql");

export async function applySchema(): Promise<void> {
  const path = config.initSqlPath || DEFAULT_INIT_SQL;
  let sql: string;
  try {
    sql = await readFile(path, "utf8");
  } catch {
    // Not bundled (e.g. the compose gateway image where Postgres applies init.sql
    // itself). Nothing to do.
    logger.info({ path }, "auto-migrate: init.sql not found, skipping");
    return;
  }
  try {
    await pool.query(sql);
    logger.info("auto-migrate: idempotent schema applied");
  } catch (err) {
    logger.error({ err }, "auto-migrate: failed (continuing; schema may already be current)");
  }
}
