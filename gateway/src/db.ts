import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export type ChatRow = {
  id: string;
  name: string | null;
  label: string | null;
  agent_enabled: boolean;
};

export type AgentState = {
  enabled: boolean;
  draft_mode: boolean;
  user_name: string;
};

export async function getAgentState(): Promise<AgentState> {
  const { rows } = await pool.query<AgentState>(
    "SELECT enabled, draft_mode, user_name FROM agent_state WHERE id = 1"
  );
  if (rows.length === 0) {
    throw new Error("agent_state row missing — did db/init.sql run?");
  }
  return rows[0]!;
}

export async function upsertChat(chat: {
  id: string;
  name?: string | null;
  label?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO chats (id, name, label) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, chats.name),
       label = COALESCE(EXCLUDED.label, chats.label)`,
    [chat.id, chat.name ?? null, chat.label ?? null]
  );
}

export async function getChat(id: string): Promise<ChatRow | null> {
  const { rows } = await pool.query<ChatRow>(
    "SELECT id, name, label, agent_enabled FROM chats WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export type MessageInsert = {
  id: string;
  chat_id: string;
  from_me: boolean;
  type: "text" | "audio" | "image" | "sticker" | "video" | "other";
  content: string | null;
  raw_media_path: string | null;
  ts: Date;
};

export async function insertMessage(m: MessageInsert): Promise<void> {
  await pool.query(
    `INSERT INTO messages (id, chat_id, from_me, type, content, raw_media_path, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [m.id, m.chat_id, m.from_me, m.type, m.content, m.raw_media_path, m.ts]
  );
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  await pool.query("UPDATE messages SET content = $1 WHERE id = $2", [content, id]);
}

export async function insertDraft(d: {
  chat_id: string;
  reply_to_id: string | null;
  content: string;
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO drafts (chat_id, reply_to_id, content) VALUES ($1, $2, $3) RETURNING id`,
    [d.chat_id, d.reply_to_id, d.content]
  );
  return rows[0]!.id;
}
