/**
 * Domain entities and value types.
 *
 * The innermost layer of the Clean Architecture: plain data shapes with no
 * dependency on Fastify, pg, Baileys, or any framework. Everything else
 * (application use cases, infrastructure adapters, HTTP controllers) depends
 * inward on these types — never the other way around.
 */

export type MessageType =
  | "text"
  | "audio"
  | "image"
  | "sticker"
  | "video"
  | "note"
  | "other";

// --- Owner notes pseudo-chat -------------------------------------------------
// A reserved chat that holds the owner's background notes. Lives in the domain
// because the reply pipeline and retrieval treat it specially.
export const OWNER_CHAT_ID = "__owner__";
export const OWNER_LABEL = "__owner__";

/**
 * Reserved label that turns a chat into a notification inbox: when the agent
 * abstains (need_info) in ANY chat, every chat tagged with this label gets a
 * WhatsApp ping. Tag the chat with your own number to be alerted on your phone.
 * Reserved — renaming it in the Labels tab breaks the routing.
 */
export const OWNER_NOTIFY_LABEL = "Owner";

// --- Agent state -------------------------------------------------------------
export type AgentState = {
  enabled: boolean;
  draft_mode: boolean;
  user_name: string;
};
export type AgentStatePatch = {
  enabled?: boolean;
  draft_mode?: boolean;
  user_name?: string;
};

// --- Chats -------------------------------------------------------------------
export type Chat = {
  id: string;
  name: string | null;
  label: string | null;
  agent_enabled: boolean;
  /** Contact phone (digits only, no '+'). Null when unknown (e.g. @lid not yet shared). */
  phone: string | null;
};
export type ChatWithStats = Chat & {
  msgs: number;
  last_ts: string | null;
};
export type ChatUpsert = {
  id: string;
  name?: string | null;
  label?: string | null;
  phone?: string | null;
};
export type ChatPatch = { label?: string | null; agent_enabled?: boolean; name?: string | null };
export type ChatListFilter = { label?: string; q?: string; limit?: number; offset?: number };

/**
 * Where a chat name came from, in ascending precedence:
 * 'push' (self-reported / pushName) < 'contact' (your WhatsApp address book) <
 * 'manual' (edited in the dashboard). Contact identification fills names but
 * never overwrites a higher-precedence source — a manual name always wins.
 */
export type ContactNameSource = "manual" | "contact" | "push";
export type ContactNameRecord = { id: string; name: string; source: ContactNameSource };

// --- Messages ----------------------------------------------------------------
export type Message = {
  id: string;
  chat_id: string;
  from_me: boolean;
  type: MessageType;
  content: string | null;
  raw_media_path: string | null;
  ts: Date;
};
/** Shape returned to the admin UI for a chat's message list. */
export type MessageView = {
  id: string;
  chat_id: string;
  from_me: boolean;
  type: string;
  content: string | null;
  ts: string;
};
export type MessageListFilter = { chatId: string; limit?: number; before?: string };

/** A message as extracted from WhatsApp, before any domain processing. */
export type IncomingMessage = {
  id: string;
  chat_id: string;
  from_me: boolean;
  sender_name: string | null;
  ts: Date;
  type: MessageType;
  text: string | null;
  mediaPath: string | null;
  /** Contact phone (digits only) derived from the JID or captured from key.senderPn. */
  phone: string | null;
};

// --- Drafts ------------------------------------------------------------------
export type DraftStatus = "pending" | "approved" | "sent" | "discarded";
/** `needs_info` drafts are abstentions: the agent lacked context and asks the owner. */
export type DraftKind = "reply" | "needs_info";
export type DraftInsert = {
  chat_id: string;
  reply_to_id: string | null;
  content: string;
  kind?: DraftKind;
  missing?: string | null;
};
export type DraftRecord = {
  id: number;
  chat_id: string;
  content: string;
  status: DraftStatus;
  kind: DraftKind;
};
export type DraftView = {
  id: number;
  chat_id: string;
  reply_to_id: string | null;
  content: string;
  status: DraftStatus;
  kind: DraftKind;
  missing: string | null;
  created_at: string;
  sent_at: string | null;
  chat_name: string | null;
  chat_label: string | null;
};
export type DraftListFilter = { status?: string; chatId?: string; limit?: number };
export type DraftPatch = { status?: "approved" | "discarded"; content?: string };

// --- Labels ------------------------------------------------------------------
export type Label = { label: string; prompt_template: string; temperature: number };
export type LabelWithStats = Label & { chats: number };
export type LabelPatch = { prompt_template?: string; temperature?: number };

// --- Owner notes -------------------------------------------------------------
export type OwnerNote = {
  id: string;
  content: string;
  raw_media_path: string | null;
  ts: string;
  embedded: boolean;
};
export type OwnerNoteInsert = {
  id: string;
  content: string;
  raw_media_path: string | null;
  ts: Date;
};

// --- RAG read model ----------------------------------------------------------
export type RagStats = {
  total_embeddings: number;
  by_label: { label: string | null; embeddings: number; chats: number }[];
  top_chats: { chat_id: string; name: string | null; label: string | null; embeddings: number }[];
  coverage: { messages_with_content: number; embedded: number };
};

// --- Activity (cross-cutting observability) ----------------------------------
export type ActivityKind =
  | "wa"
  | "sender"
  | "message-in"
  | "message-out"
  | "draft"
  | "ai"
  | "batch"
  | "system"
  | "error";
export type ActivityLevel = "info" | "success" | "warn" | "error";
