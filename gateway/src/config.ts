import { config as loadDotenv } from "dotenv";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// gateway/src/config.ts -> project root is two levels up
const GATEWAY_DIR = resolve(__dirname, "..");
const PROJECT_ROOT = resolve(__dirname, "../..");

loadDotenv({ path: resolve(PROJECT_ROOT, ".env") });
loadDotenv({ path: resolve(GATEWAY_DIR, ".env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function resolveDir(envValue: string | undefined, fallback: string): string {
  const raw = envValue ?? fallback;
  return isAbsolute(raw) ? raw : resolve(GATEWAY_DIR, raw);
}

type AuthStore = "files" | "dynamo";

export const config = {
  databaseUrl: required("DATABASE_URL"),
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  // PORT is what Render (and most PaaS) inject; GATEWAY_PORT wins locally.
  gatewayPort: Number(process.env.GATEWAY_PORT ?? process.env.PORT ?? 3000),
  // Resolved relative to gateway/, regardless of cwd
  waSessionDir: resolveDir(process.env.WA_SESSION_DIR, ".wa-session"),
  waMediaDir: resolveDir(process.env.WA_MEDIA_DIR, ".wa-media"),

  // Where the Baileys session lives: "files" (local disk, default) or "dynamo"
  // (DynamoDB) for ephemeral-disk hosts like Render. See infrastructure/auth-state.ts.
  waAuthStore: (process.env.WA_AUTH_STORE === "dynamo" ? "dynamo" : "files") as AuthStore,
  waSessionId: process.env.WA_SESSION_ID ?? "default",
  dynamoAuthTable: process.env.WA_AUTH_TABLE ?? "",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",

  // Optional Basic Auth gate for the admin API + dashboard. Enabled only when
  // ADMIN_PASSWORD is set (so local dev stays open). Required when the gateway
  // is exposed on a public URL (Render) — the dashboard has no login of its own.
  adminUser: process.env.ADMIN_USER ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",

  // When set, the gateway also serves the built frontend (SPA) from this dir,
  // same-origin as /api. Used on Render so one service + one Basic Auth prompt
  // covers both. Unset in docker-compose (nginx serves the frontend there).
  frontendDist: process.env.FRONTEND_DIST ?? "",

  // Proactive scheduler: periodic, per-chat unprompted messages. Master switch
  // (PROACTIVE_SCHEDULER=off disables the loop entirely) + how often it ticks.
  // The per-chat interval range lives in the DB (defaults 1–60 min) and is set
  // per chat from the dashboard/CLI — not from env.
  proactiveSchedulerEnabled: (process.env.PROACTIVE_SCHEDULER ?? "on") !== "off",
  proactiveTickMs: Number(process.env.PROACTIVE_TICK_MS ?? 30000),

  // Apply the idempotent db/init.sql at startup so a managed DB self-heals after
  // a schema-changing deploy (no separate migration runner). AUTO_MIGRATE=off to
  // disable; DB_INIT_SQL overrides the path to the schema file.
  autoMigrate: (process.env.AUTO_MIGRATE ?? "on") !== "off",
  initSqlPath: process.env.DB_INIT_SQL ?? "",
};
