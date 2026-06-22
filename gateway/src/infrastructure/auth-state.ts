/**
 * Auth-state factory: picks where the Baileys session lives.
 *
 * - `files`  (default) → `useMultiFileAuthState` on local disk. Used for local
 *   dev and the docker-compose stack (session in a named volume).
 * - `dynamo`           → `useDynamoAuthState` (DynamoDB). Used on ephemeral-disk
 *   hosts like Render so the session survives spin-down without re-scanning.
 *
 * Both return the same shape Baileys expects (`{ state, saveCreds }`) plus a
 * `clearAll()` that wipes the persisted session (called on loggedOut).
 */
import { mkdir, rm } from "node:fs/promises";
import { useMultiFileAuthState, type AuthenticationState } from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { useDynamoAuthState } from "./dynamo-auth.js";

export type AuthStateHandle = {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearAll: () => Promise<void>;
};

export async function getAuthState(opts: {
  /** Disk directory for the `files` store. */
  sessionDir: string;
  /** Logical session id; namespaces items in the `dynamo` store. */
  sessionId: string;
}): Promise<AuthStateHandle> {
  if (config.waAuthStore === "dynamo") {
    if (!config.dynamoAuthTable) {
      throw new Error("WA_AUTH_STORE=dynamo requires WA_AUTH_TABLE to be set");
    }
    return useDynamoAuthState(config.dynamoAuthTable, opts.sessionId, config.awsRegion);
  }

  await mkdir(opts.sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(opts.sessionDir);
  return {
    state,
    saveCreds,
    clearAll: () => rm(opts.sessionDir, { recursive: true, force: true }),
  };
}
