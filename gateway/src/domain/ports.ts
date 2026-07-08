/**
 * Ports: the interfaces the application layer depends on.
 *
 * These describe *what* the use cases need (persistence, AI, messaging,
 * eventing, logging) without saying *how* — the "how" lives in
 * `infrastructure/` adapters that implement these interfaces. This is the
 * dependency-inversion boundary: application -> ports <- infrastructure.
 */
import type {
  AgentState,
  AgentStatePatch,
  Chat,
  ChatBulkFilter,
  ChatListFilter,
  ChatPatch,
  ChatUpsert,
  ChatWithStats,
  ContactNameRecord,
  DraftInsert,
  DraftListFilter,
  DraftPatch,
  DraftRecord,
  DraftView,
  Label,
  LabelPatch,
  LabelWithStats,
  Message,
  MessageListFilter,
  MessageView,
  OwnerNote,
  OwnerNoteInsert,
  RagStats,
  ActivityKind,
  ActivityLevel,
} from "./entities.js";

// --- Repositories (persistence gateways) ------------------------------------

export interface AgentStateRepository {
  get(): Promise<AgentState>;
  patch(patch: AgentStatePatch): Promise<AgentState>;
}

export interface ChatRepository {
  get(id: string): Promise<Chat | null>;
  getWithStats(id: string): Promise<ChatWithStats | null>;
  list(filter: ChatListFilter): Promise<ChatWithStats[]>;
  upsert(chat: ChatUpsert): Promise<void>;
  patch(id: string, patch: ChatPatch): Promise<void>;
  /**
   * Bulk enable/disable the agent for every chat matching the filter (same
   * substring `q` + `label` matching as `list`). Skips the reserved owner chat.
   * Returns the number of chats updated.
   */
  bulkSetAgentEnabled(filter: ChatBulkFilter, enabled: boolean): Promise<number>;
  /** Bulk enable/disable the agent for an explicit selection of chat ids (owner skipped). */
  bulkSetAgentEnabledByIds(ids: string[], enabled: boolean): Promise<number>;
  /**
   * Auto-exclusion by name: disable the agent for chats whose name contains any
   * pattern (case-insensitive). One-way — never re-enables. Returns count updated.
   */
  disableByNamePatterns(patterns: string[]): Promise<number>;
  ensureOwnerChat(): Promise<void>;
  /**
   * Persist contact names (batched) onto EXISTING chats only — names attach to
   * conversations, never create a row per address-book contact. Updates a name
   * only when the incoming source has >= precedence than the stored one, so a
   * manual name is never clobbered. Returns the number of rows updated.
   */
  recordContactNames(records: ContactNameRecord[]): Promise<number>;
  /** Count chats that already have a name — drives the address-book resync heuristic. */
  countNamed(): Promise<number>;
  /** Proactive-enabled chats whose next scheduled send is due at or before `now`. */
  listProactiveDue(now: Date): Promise<Chat[]>;
}

export interface MessageRepository {
  insert(message: Message): Promise<void>;
  updateContent(id: string, content: string): Promise<void>;
  listByChat(filter: MessageListFilter): Promise<MessageView[]>;
  /** Returns the text content of a single message, or null if missing/empty. */
  getContent(id: string): Promise<string | null>;
  /** Direction + timestamp of the most recent message in a chat; null if empty. */
  lastByChat(chatId: string): Promise<{ from_me: boolean; ts: string } | null>;
}

export interface DraftRepository {
  insert(draft: DraftInsert): Promise<number>;
  list(filter: DraftListFilter): Promise<DraftView[]>;
  getById(id: number): Promise<DraftRecord | null>;
  patch(id: number, patch: DraftPatch): Promise<void>;
  markSent(id: number): Promise<void>;
  delete(id: number): Promise<void>;
  /** True if the chat has an unresolved abstention (pending `needs_info` draft). */
  hasPendingNeedInfo(chatId: string): Promise<boolean>;
}

export interface LabelRepository {
  list(): Promise<LabelWithStats[]>;
  upsert(label: Label): Promise<void>;
  patch(label: string, patch: LabelPatch): Promise<void>;
  countChats(label: string): Promise<number>;
  delete(label: string): Promise<void>;
}

export interface OwnerNoteRepository {
  list(): Promise<OwnerNote[]>;
  create(note: OwnerNoteInsert): Promise<void>;
  /** Returns false if no row matched (not an owner note / wrong id). */
  update(id: string, content: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export interface RagReadModel {
  stats(): Promise<RagStats>;
}

// --- External services ------------------------------------------------------

export type RetrieveResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string };

export interface AiService {
  respond(input: {
    chat_id: string;
    message_text: string;
    sender_name: string | null;
  }): Promise<{ status: "answer" | "need_info"; reply: string; missing: string | null }>;
  /**
   * Generate an unprompted, contextual message to RESUME a conversation, from
   * the chat's most recent context. Same `{status, reply, missing}` contract as
   * `respond`: `need_info` means "nothing grounded to say now" — the caller then
   * abstains instead of sending an invented message.
   */
  generateProactive(input: {
    chat_id: string;
  }): Promise<{ status: "answer" | "need_info"; reply: string; missing: string | null }>;
  transcribe(audioPath: string): Promise<string>;
  embedAndStore(input: {
    message_id: string;
    chat_id: string;
    label: string | null;
    content: string;
  }): Promise<void>;
  retrieve(body: unknown): Promise<RetrieveResult>;
  healthcheck(): Promise<boolean>;
}

/** Outbound WhatsApp messaging — send only; cadence/presence live in the adapter. */
export interface WhatsAppGateway {
  /** Sends text with human cadence; resolves to the sent message id, or null. */
  sendText(chatId: string, text: string): Promise<{ id: string } | null>;
}

// --- Cross-cutting ports ----------------------------------------------------

export interface EventPublisher {
  messageStored(payload: {
    id: string;
    chat_id: string;
    from_me: boolean;
    content: string | null;
    ts: string;
  }): void;
  draftCreated(payload: {
    id: number;
    chat_id: string;
    content: string;
    kind?: "reply" | "needs_info";
    missing?: string | null;
    created_at: string;
  }): void;
}

export interface ActivityLog {
  push(entry: {
    kind: ActivityKind;
    level: ActivityLevel;
    message: string;
    meta?: Record<string, unknown>;
  }): void;
}

export interface AppLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface Clock {
  now(): Date;
}
