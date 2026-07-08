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
  /** Owner instruction injected into every reply, on top of the per-label template. */
  global_prompt: string;
  /**
   * Auto-exclusion by name (one pattern per line, case-insensitive "contains").
   * Chats whose name matches any pattern get the agent disabled automatically —
   * on save and as contact names sync in. Mirrors telegram-sender's
   * "auto-excluir por patrón de nombre". Never re-enables by itself.
   */
  exclude_patterns: string;
};
export type AgentStatePatch = {
  enabled?: boolean;
  draft_mode?: boolean;
  user_name?: string;
  global_prompt?: string;
  exclude_patterns?: string;
};

// --- Chats -------------------------------------------------------------------
export type Chat = {
  id: string;
  name: string | null;
  label: string | null;
  agent_enabled: boolean;
  /** Contact phone (digits only, no '+'). Null when unknown (e.g. @lid not yet shared). */
  phone: string | null;
  /**
   * Agent account (digits) this chat was synced under — set once, on first
   * activity, and never overwritten. Distinguishes chats belonging to an older
   * linked number if the agent is ever re-paired with a different one.
   */
  wa_account: string | null;
  /**
   * Proactive messaging: when on, the scheduler periodically writes an
   * unprompted message to this chat (in the owner's voice, from the latest
   * context) at a random interval in [min, max] minutes. Opt-in per chat.
   */
  proactive_enabled: boolean;
  proactive_min_minutes: number;
  proactive_max_minutes: number;
  /** ISO timestamp of the next scheduled proactive send; null when unscheduled. */
  proactive_next_ts: string | null;
  /** Consecutive proactive nudges with no contact reply; reset to 0 when the contact writes. */
  proactive_unanswered: number;
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
  /** Agent account (digits) seen when this chat had activity; only the first value sticks. */
  wa_account?: string | null;
};
export type ChatPatch = {
  label?: string | null;
  agent_enabled?: boolean;
  name?: string | null;
  proactive_enabled?: boolean;
  proactive_min_minutes?: number;
  proactive_max_minutes?: number;
  /** Internal: set by ChatService/scheduler, never accepted straight from the HTTP body. */
  proactive_next_ts?: Date | null;
  /** Internal: nudge counter, managed by the pipeline/scheduler. */
  proactive_unanswered?: number;
};
export type ChatListFilter = { label?: string; q?: string; limit?: number; offset?: number };
/** Filter for bulk operations — same matching as the list (substring q + label), no paging. */
export type ChatBulkFilter = { label?: string; q?: string };

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
  /** Agent account (digits) that received this message — ties the chat to the synced number. */
  account: string | null;
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
export type Label = {
  label: string;
  prompt_template: string;
  temperature: number;
  // Umbral de relevancia del RAG (distancia coseno máx.) para esta etiqueta.
  max_distance: number;
  // Few-shot "de oro": ejemplos curados del estilo del dueño para esta etiqueta.
  examples: string | null;
};
export type LabelWithStats = Label & { chats: number };
export type LabelPatch = {
  prompt_template?: string;
  temperature?: number;
  max_distance?: number;
  examples?: string | null;
};

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
