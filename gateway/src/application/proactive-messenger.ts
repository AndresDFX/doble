/**
 * Proactive messenger: the scheduled, unprompted side of the agent.
 *
 * On each tick it finds the chats whose next proactive send is due, asks the AI
 * for a short contextual message ("resume the conversation"), and delivers it
 * the same way a normal reply is delivered — respecting `draft_mode` (draft vs
 * auto-send) and the human send cadence. It never invents: if the model has
 * nothing grounded to say it abstains for that cycle. Mirrors telegram-sender's
 * dispatcher (a periodic tick that materialises due work) but for a single
 * process, so no distributed lock is needed — just a non-overlapping interval.
 *
 * Knows nothing about Baileys, Fastify or Postgres: everything is a domain port.
 */
import type { AgentState, Chat } from "../domain/entities.js";
import type {
  ActivityLog,
  AgentStateRepository,
  AiService,
  AppLogger,
  ChatRepository,
  Clock,
  DraftRepository,
  EventPublisher,
  MessageRepository,
  WhatsAppGateway,
} from "../domain/ports.js";
import { deliveryMode } from "../domain/reply-policy.js";
import { decideProactive, nextProactiveAt } from "../domain/proactive-policy.js";
import { deliverReply } from "./reply-delivery.js";

export type ProactiveMessengerDeps = {
  chats: ChatRepository;
  messages: MessageRepository;
  drafts: DraftRepository;
  agentState: AgentStateRepository;
  ai: AiService;
  whatsapp: WhatsAppGateway;
  events: EventPublisher;
  activity: ActivityLog;
  clock: Clock;
  logger: AppLogger;
};

export class ProactiveMessenger {
  constructor(private readonly deps: ProactiveMessengerDeps) {}

  /** One scheduler pass: deliver to every chat whose proactive send is due. */
  async tick(): Promise<void> {
    const d = this.deps;

    let state: AgentState;
    try {
      state = await d.agentState.get();
    } catch (err) {
      d.logger.warn({ err }, "proactive tick: could not read agent state");
      return;
    }
    if (!state.enabled) return; // global switch off → nothing proactive happens

    const now = d.clock.now();
    let due: Chat[];
    try {
      due = await d.chats.listProactiveDue(now);
    } catch (err) {
      d.logger.warn({ err }, "proactive tick: could not list due chats");
      return;
    }
    if (due.length === 0) return;

    d.logger.debug({ count: due.length }, "proactive tick: due chats");
    // Sequential on purpose: spreads sends out (the gateway adds a 2–8s human
    // cadence per send) and stays within Gemini's free-tier RPM.
    for (const chat of due) {
      await this.runForChat(chat, state);
    }
  }

  /** Generate + deliver (or draft) one proactive message; always reschedules. */
  async runForChat(chat: Chat, state: AgentState): Promise<void> {
    const d = this.deps;
    try {
      const decision = decideProactive(state, chat);
      if (!decision.ok) {
        // The query already filters proactive_enabled, but agent_enabled or the
        // global switch may have flipped between queue and run. Skip (reschedules).
        d.logger.debug({ chat_id: chat.id, reason: decision.reason }, "proactive: skipped (policy)");
        return;
      }

      const mode = deliveryMode(state);

      // Anti-pile-up: in draft mode, don't stack a second proactive draft on a
      // chat that still has one waiting for review.
      if (mode === "draft") {
        const pending = await d.drafts.list({ status: "pending", chatId: chat.id, limit: 1 });
        if (pending.length > 0) {
          d.logger.debug({ chat_id: chat.id }, "proactive: skipped (pending draft exists)");
          return;
        }
      }

      const result = await d.ai.generateProactive({ chat_id: chat.id });

      // Abstención: nothing grounded/natural to say right now — never invent.
      if (result.status === "need_info" || !result.reply.trim()) {
        d.activity.push({
          kind: "ai",
          level: "info",
          message: `Proactivo: nada que decir aún en ${chat.name ?? chat.id}`,
          meta: { chat_id: chat.id, label: chat.label, missing: result.missing, proactive: true },
        });
        d.logger.debug({ chat_id: chat.id }, "proactive: abstained (need_info/empty)");
        return;
      }

      const reply = result.reply.trim();

      if (mode === "draft") {
        const draftId = await d.drafts.insert({
          chat_id: chat.id,
          reply_to_id: null,
          content: reply,
        });
        d.events.draftCreated({
          id: draftId,
          chat_id: chat.id,
          content: reply,
          created_at: d.clock.now().toISOString(),
        });
        d.activity.push({
          kind: "draft",
          level: "info",
          message: `Borrador proactivo #${draftId} para ${chat.name ?? chat.id}`,
          meta: { chat_id: chat.id, label: chat.label, preview: reply.slice(0, 80), proactive: true },
        });
        d.logger.info({ draftId, chat_id: chat.id }, "Proactive draft saved (draft_mode=true)");
        return;
      }

      await deliverReply(
        {
          whatsapp: d.whatsapp,
          messages: d.messages,
          ai: d.ai,
          events: d.events,
          clock: d.clock,
          logger: d.logger,
        },
        chat.id,
        reply,
        chat.label
      );
      d.activity.push({
        kind: "message-out",
        level: "success",
        message: `Mensaje proactivo enviado a ${chat.name ?? chat.id}`,
        meta: { chat_id: chat.id, label: chat.label, preview: reply.slice(0, 80), proactive: true },
      });
      d.logger.info({ chat_id: chat.id }, "Proactive message sent");
    } catch (err) {
      d.logger.error({ err, chat_id: chat.id }, "proactive: runForChat failed");
      d.activity.push({
        kind: "error",
        level: "error",
        message: `Proactivo falló en ${chat.name ?? chat.id}: ${(err as Error).message}`,
        meta: { chat_id: chat.id },
      });
    } finally {
      // ALWAYS reschedule — even on error or abstención — so a bad cycle never
      // stops the chat's cadence and a due row never hot-loops the scheduler.
      await this.reschedule(chat);
    }
  }

  private async reschedule(chat: Chat): Promise<void> {
    const d = this.deps;
    try {
      const next = nextProactiveAt(
        d.clock.now(),
        chat.proactive_min_minutes,
        chat.proactive_max_minutes
      );
      await d.chats.patch(chat.id, { proactive_next_ts: next });
      d.logger.debug({ chat_id: chat.id, next: next.toISOString() }, "proactive: rescheduled");
    } catch (err) {
      d.logger.warn({ err, chat_id: chat.id }, "proactive: failed to reschedule");
    }
  }
}

/**
 * Start the periodic scheduler. Non-overlapping: a slow tick (AI latency + send
 * cadence) is never re-entered. Returns a stop handle. `unref`s the timer so it
 * never keeps the process alive on its own.
 */
export function startProactiveScheduler(
  messenger: ProactiveMessenger,
  logger: AppLogger,
  opts: { tickMs: number }
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void messenger
      .tick()
      .catch((err) => logger.error({ err }, "Proactive scheduler tick crashed"))
      .finally(() => {
        running = false;
      });
  }, opts.tickMs);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ tickMs: opts.tickMs }, "Proactive scheduler started");
  return () => clearInterval(timer);
}
