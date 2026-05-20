import { pool } from "./db.js";

export const OWNER_CHAT_ID = "__owner__";
export const OWNER_LABEL = "__owner__";

let ensured = false;

export async function ensureOwnerChat(): Promise<void> {
  if (ensured) return;
  await pool.query(
    `INSERT INTO chats (id, name, label, agent_enabled)
     VALUES ($1, 'Notas del dueño', $2, FALSE)
     ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label`,
    [OWNER_CHAT_ID, OWNER_LABEL]
  );
  ensured = true;
}
