import pg from "pg";
import { config } from "./config.js";

/**
 * SSL config derived from the connection string's `sslmode`. Managed Postgres
 * (Supabase, Neon) requires TLS — their strings carry `?sslmode=require`. We set
 * `ssl` explicitly (instead of relying on node-pg's string parsing) so the
 * connection never fails on cert-chain verification: `verify-ca`/`verify-full`
 * validate the cert, `require`/`prefer` just encrypt. Local (no sslmode) → plain.
 */
function sslFromUrl(url: string): pg.PoolConfig["ssl"] {
  const mode = /[?&]sslmode=([^&]+)/.exec(url)?.[1];
  if (!mode || mode === "disable") return undefined;
  return { rejectUnauthorized: mode.startsWith("verify") };
}

/**
 * The shared Postgres connection pool — the single low-level database handle.
 *
 * Domain data access goes through the repository adapters in
 * `infrastructure/repositories.ts`; this module just owns the connection.
 * Peripheral tooling (scripts, sender) may import the pool directly.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: sslFromUrl(config.databaseUrl),
});
