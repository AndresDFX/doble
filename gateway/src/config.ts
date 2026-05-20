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

export const config = {
  databaseUrl: required("DATABASE_URL"),
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  gatewayPort: Number(process.env.GATEWAY_PORT ?? 3000),
  // Resolved relative to gateway/, regardless of cwd
  waSessionDir: resolveDir(process.env.WA_SESSION_DIR, ".wa-session"),
  waMediaDir: resolveDir(process.env.WA_MEDIA_DIR, ".wa-media"),
};
