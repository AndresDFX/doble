import pg from "pg";
import { config } from "./config.js";

/**
 * The shared Postgres connection pool — the single low-level database handle.
 *
 * Domain data access goes through the repository adapters in
 * `infrastructure/repositories.ts`; this module just owns the connection.
 * Peripheral tooling (scripts, sender) may import the pool directly.
 */
export const pool = new pg.Pool({ connectionString: config.databaseUrl });
