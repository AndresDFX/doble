/**
 * Application services: one per HTTP resource. They orchestrate repositories
 * and external-service ports, returning plain domain data (or small result
 * unions for outcomes that map to HTTP status codes). Controllers stay thin;
 * SQL and framework details live in infrastructure.
 */
import { randomUUID } from "node:crypto";
import { OWNER_CHAT_ID, OWNER_LABEL } from "../domain/entities.js";
import type {
  AgentState,
  AgentStatePatch,
  ChatBulkFilter,
  ChatListFilter,
  ChatPatch,
  ChatWithStats,
  ContactNameRecord,
  DraftListFilter,
  DraftPatch,
  DraftView,
  Label,
  LabelPatch,
  LabelWithStats,
  MessageListFilter,
  MessageView,
  OwnerNote,
  RagStats,
} from "../domain/entities.js";
import type {
  ActivityLog,
  AgentStateRepository,
  AiService,
  AppLogger,
  ChatRepository,
  Clock,
  DraftRepository,
  EventPublisher,
  LabelRepository,
  MessageRepository,
  OwnerNoteRepository,
  RagReadModel,
  RetrieveResult,
} from "../domain/ports.js";
import { deliverReply, type ReplyDeliveryDeps } from "./reply-delivery.js";
import { clampMinutes, nextProactiveAt } from "../domain/proactive-policy.js";

// --- Agent state ------------------------------------------------------------

export class AgentStateService {
  constructor(private readonly repo: AgentStateRepository) {}
  get(): Promise<AgentState> {
    return this.repo.get();
  }
  patch(patch: AgentStatePatch): Promise<AgentState> {
    return this.repo.patch(patch);
  }
}

// --- Chats ------------------------------------------------------------------

export class ChatService {
  constructor(
    private readonly chats: ChatRepository,
    private readonly messages: MessageRepository,
    private readonly clock: Clock
  ) {}
  list(filter: ChatListFilter): Promise<ChatWithStats[]> {
    return this.chats.list(filter);
  }
  get(id: string): Promise<ChatWithStats | null> {
    return this.chats.getWithStats(id);
  }

  /**
   * Patch a chat, applying proactive-scheduling side effects: enabling proactive
   * (when not already scheduled) seeds the first `proactive_next_ts`; disabling
   * clears it. Ranges are clamped defensively. The scheduler owns reschedules
   * thereafter — this only handles the on/off transitions from the UI/CLI.
   */
  async patch(id: string, patch: ChatPatch): Promise<void> {
    const next: ChatPatch = { ...patch };
    if (next.proactive_min_minutes !== undefined) {
      next.proactive_min_minutes = clampMinutes(next.proactive_min_minutes);
    }
    if (next.proactive_max_minutes !== undefined) {
      next.proactive_max_minutes = clampMinutes(next.proactive_max_minutes);
    }

    if (next.proactive_enabled === false) {
      next.proactive_next_ts = null;
    } else if (next.proactive_enabled === true) {
      const chat = await this.chats.get(id);
      // Only seed a schedule if there isn't one — so re-saving an already-enabled
      // chat (e.g. just changing the range) doesn't reset its cadence.
      if (!chat?.proactive_next_ts) {
        const min = next.proactive_min_minutes ?? chat?.proactive_min_minutes ?? 1;
        const max = next.proactive_max_minutes ?? chat?.proactive_max_minutes ?? 60;
        next.proactive_next_ts = nextProactiveAt(this.clock.now(), min, max);
      }
    }

    return this.chats.patch(id, next);
  }
  /** Bulk enable/disable the agent for chats matching a filter. Returns count updated. */
  bulkSetAgent(filter: ChatBulkFilter, enabled: boolean): Promise<number> {
    return this.chats.bulkSetAgentEnabled(filter, enabled);
  }
  listMessages(filter: MessageListFilter): Promise<MessageView[]> {
    return this.messages.listByChat(filter);
  }
  /** Contact identification: persist names harvested from WhatsApp (batched). */
  recordContactNames(records: ContactNameRecord[]): Promise<number> {
    return this.chats.recordContactNames(records);
  }
  countNamed(): Promise<number> {
    return this.chats.countNamed();
  }
}

// --- Drafts -----------------------------------------------------------------

export type SendDraftResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export class DraftService {
  constructor(
    private readonly drafts: DraftRepository,
    private readonly chats: ChatRepository,
    private readonly delivery: ReplyDeliveryDeps
  ) {}

  list(filter: DraftListFilter): Promise<DraftView[]> {
    return this.drafts.list(filter);
  }
  patch(id: number, patch: DraftPatch): Promise<void> {
    return this.drafts.patch(id, patch);
  }
  delete(id: number): Promise<void> {
    return this.drafts.delete(id);
  }

  async send(id: number): Promise<SendDraftResult> {
    const draft = await this.drafts.getById(id);
    if (!draft) return { ok: false, status: 404, error: "draft not found" };
    if (draft.status === "sent") return { ok: false, status: 409, error: "already sent" };

    const chat = await this.chats.get(draft.chat_id);
    await deliverReply(this.delivery, draft.chat_id, draft.content, chat?.label ?? null);
    await this.drafts.markSent(draft.id);
    return { ok: true };
  }
}

// --- Labels -----------------------------------------------------------------

export type DeleteLabelResult =
  | { ok: true }
  | { ok: false; status: 400 | 409; error: string };

export class LabelService {
  constructor(private readonly labels: LabelRepository) {}

  list(): Promise<LabelWithStats[]> {
    return this.labels.list();
  }
  upsert(label: Label): Promise<void> {
    return this.labels.upsert({
      ...label,
      temperature: label.temperature ?? 0.7,
      max_distance: label.max_distance ?? 1.3,
      examples: label.examples ?? null,
    });
  }
  patch(label: string, patch: LabelPatch): Promise<void> {
    return this.labels.patch(label, patch);
  }
  async remove(label: string): Promise<DeleteLabelResult> {
    if (label === "default") {
      return { ok: false, status: 400, error: "cannot delete the 'default' label" };
    }
    const used = await this.labels.countChats(label);
    if (used > 0) {
      return { ok: false, status: 409, error: "label in use by chats; reassign first" };
    }
    await this.labels.delete(label);
    return { ok: true };
  }
}

// --- Owner notes ------------------------------------------------------------

export type UpdateOwnerNoteResult = { ok: true } | { ok: false; status: 404; error: string };

export class OwnerNoteService {
  constructor(
    private readonly notes: OwnerNoteRepository,
    private readonly chats: ChatRepository,
    private readonly ai: AiService,
    private readonly events: EventPublisher,
    private readonly activity: ActivityLog,
    private readonly clock: Clock,
    private readonly logger: AppLogger
  ) {}

  ensureOwnerChat(): Promise<void> {
    return this.chats.ensureOwnerChat();
  }

  list(): Promise<OwnerNote[]> {
    return this.notes.list();
  }

  /** Transcribe a saved audio file with the AI service, recording activity. */
  async transcribe(path: string): Promise<string> {
    const text = await this.ai.transcribe(path);
    this.activity.push({
      kind: "ai",
      level: "success",
      message: `Audio transcrito (${text.length} caracteres)`,
      meta: { preview: text.slice(0, 80) },
    });
    return text;
  }

  async create(input: {
    content: string;
    raw_media_path?: string | null;
  }): Promise<{ id: string; content: string; ts: string }> {
    await this.chats.ensureOwnerChat();
    const content = input.content.trim();
    const id = randomUUID();
    const ts = this.clock.now();

    await this.notes.create({ id, content, raw_media_path: input.raw_media_path ?? null, ts });
    this.events.messageStored({
      id,
      chat_id: OWNER_CHAT_ID,
      from_me: true,
      content,
      ts: ts.toISOString(),
    });
    this.activity.push({
      kind: "system",
      level: "success",
      message: `Nota del dueño guardada (${content.length} chars)`,
      meta: { id, preview: content.slice(0, 80) },
    });

    try {
      await this.ai.embedAndStore({ message_id: id, chat_id: OWNER_CHAT_ID, label: OWNER_LABEL, content });
      this.activity.push({ kind: "ai", level: "success", message: "Nota embedded en pgvector", meta: { id } });
    } catch (err) {
      this.logger.error({ err, id }, "Failed to embed owner note");
      this.activity.push({
        kind: "ai",
        level: "error",
        message: `No se pudo embedder la nota: ${(err as Error).message}`,
        meta: { id },
      });
    }

    // Preserve the original API contract: only id/content/ts.
    return { id, content, ts: ts.toISOString() };
  }

  async update(id: string, content: string): Promise<UpdateOwnerNoteResult> {
    const ok = await this.notes.update(id, content);
    if (!ok) return { ok: false, status: 404, error: "note not found" };
    try {
      await this.ai.embedAndStore({ message_id: id, chat_id: OWNER_CHAT_ID, label: OWNER_LABEL, content });
      this.activity.push({
        kind: "system",
        level: "info",
        message: `Nota ${id.slice(0, 8)} editada y re-embedded`,
      });
    } catch (err) {
      this.activity.push({
        kind: "ai",
        level: "warn",
        message: `Nota editada pero re-embedding falló: ${(err as Error).message}`,
      });
    }
    return { ok: true };
  }

  async remove(id: string): Promise<UpdateOwnerNoteResult> {
    const ok = await this.notes.delete(id);
    if (!ok) return { ok: false, status: 404, error: "note not found" };
    this.activity.push({
      kind: "system",
      level: "warn",
      message: `Nota ${id.slice(0, 8)} eliminada`,
    });
    return { ok: true };
  }
}

// --- RAG --------------------------------------------------------------------

export class RagService {
  constructor(
    private readonly readModel: RagReadModel,
    private readonly ai: AiService
  ) {}
  stats(): Promise<RagStats> {
    return this.readModel.stats();
  }
  retrieve(body: unknown): Promise<RetrieveResult> {
    return this.ai.retrieve(body);
  }
}

// --- Health -----------------------------------------------------------------

export type HealthSnapshot = {
  gateway: "ok";
  db: "ok" | "down";
  ai: "ok" | "down";
  wa: string;
  at: string;
};

export class HealthService {
  constructor(
    private readonly ai: AiService,
    private readonly pingDb: () => Promise<boolean>,
    private readonly waConnection: () => string,
    private readonly clock: Clock
  ) {}

  async snapshot(): Promise<HealthSnapshot> {
    const [dbOk, aiOk] = await Promise.all([this.pingDb(), this.ai.healthcheck()]);
    return {
      gateway: "ok",
      db: dbOk ? "ok" : "down",
      ai: aiOk ? "ok" : "down",
      wa: this.waConnection(),
      at: this.clock.now().toISOString(),
    };
  }
}
