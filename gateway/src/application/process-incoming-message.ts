/**
 * The core use case: process one inbound WhatsApp message.
 *
 * Orchestrates persistence, transcription, embedding, the reply decision, and
 * delivery (draft vs auto-send) — entirely through domain ports, with the pure
 * rules delegated to `reply-policy`. Knows nothing about Baileys, Fastify, or
 * Postgres.
 */
import type { Chat, IncomingMessage } from "../domain/entities.js";
import { OWNER_NOTIFY_LABEL } from "../domain/entities.js";
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
import {
  decideReply,
  deliveryMode,
  hasText,
  holdForInfo,
  isOwnMessage,
  needsTranscription,
} from "../domain/reply-policy.js";
import { nextProactiveAt } from "../domain/proactive-policy.js";
import { deliverReply } from "./reply-delivery.js";

export type ProcessIncomingDeps = {
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

export class ProcessIncomingMessage {
  constructor(private readonly deps: ProcessIncomingDeps) {}

  async execute(
    msg: IncomingMessage,
    opts: { shouldReply: boolean } = { shouldReply: true }
  ): Promise<void> {
    const d = this.deps;

    await d.chats.upsert({ id: msg.chat_id, phone: msg.phone ?? undefined });
    await d.messages.insert({
      id: msg.id,
      chat_id: msg.chat_id,
      from_me: msg.from_me,
      type: msg.type,
      content: msg.text,
      raw_media_path: msg.mediaPath,
      ts: msg.ts,
    });
    d.events.messageStored({
      id: msg.id,
      chat_id: msg.chat_id,
      from_me: msg.from_me,
      content: msg.text,
      ts: msg.ts.toISOString(),
    });
    d.activity.push({
      kind: msg.from_me ? "message-out" : "message-in",
      level: "info",
      message: `${msg.from_me ? "→" : "←"} ${msg.type} ${
        msg.text ? `"${msg.text.slice(0, 80)}"` : "(sin texto)"
      }`,
      meta: { chat_id: msg.chat_id, type: msg.type, sender: msg.sender_name },
    });

    if (isOwnMessage(msg)) {
      d.logger.debug({ id: msg.id }, "Own message — stored, no reply");
      return;
    }

    if (needsTranscription(msg)) {
      try {
        const text = await d.ai.transcribe(msg.mediaPath!);
        await d.messages.updateContent(msg.id, text);
        msg.text = text;
        d.logger.info({ id: msg.id, text }, "Audio transcribed");
      } catch (err) {
        d.logger.error({ err, id: msg.id }, "Transcription failed");
        return;
      }
    }

    if (!hasText(msg)) {
      d.logger.debug({ id: msg.id, type: msg.type }, "No text content — skipping reply");
      return;
    }

    const chat = await d.chats.get(msg.chat_id);

    void d.ai
      .embedAndStore({
        message_id: msg.id,
        chat_id: msg.chat_id,
        label: chat?.label ?? null,
        content: msg.text!,
      })
      .catch((err) => d.logger.warn({ err, id: msg.id }, "Failed to embed incoming message"));

    if (!opts.shouldReply) {
      d.logger.debug({ id: msg.id }, "Persist-only (replayed offline message)");
      return;
    }

    // The contact just wrote: restart the proactive "silence" window and clear
    // the nudge cap for this chat (only when proactive is on). This is what makes
    // proactive re-engage only after real silence, and lets it nudge again later.
    if (chat?.proactive_enabled) {
      const t = d.clock.now();
      await d.chats
        .patch(msg.chat_id, {
          proactive_unanswered: 0,
          proactive_next_ts: nextProactiveAt(
            t,
            chat.proactive_min_minutes,
            chat.proactive_max_minutes
          ),
        })
        .catch((err) => d.logger.warn({ err, chat_id: msg.chat_id }, "proactive reset failed"));
    }

    const state = await d.agentState.get();
    const decision = decideReply(state, chat);
    if (!decision.reply) {
      d.logger.debug(
        { chat_id: msg.chat_id, reason: decision.reason },
        decision.reason === "agent-disabled"
          ? "Agent globally disabled"
          : "Agent disabled for this chat"
      );
      return;
    }

    // R1 — while an abstention is unresolved, pause the chat: don't answer newer
    // messages out of order until the owner supplies the missing context (a note
    // resolves it via RetryNeedInfo). The message is already persisted.
    if (await d.drafts.hasPendingNeedInfo(msg.chat_id)) {
      d.logger.info(
        { chat_id: msg.chat_id },
        "Reply paused — unresolved need_info for this chat"
      );
      d.activity.push({
        kind: "system",
        level: "info",
        message: `En pausa: falta contexto pendiente en ${chat?.name ?? msg.chat_id}`,
        meta: { chat_id: msg.chat_id },
      });
      return;
    }

    let result: { status: "answer" | "need_info"; reply: string; missing: string | null };
    const aiStart = d.clock.now().getTime();
    try {
      result = await d.ai.respond({
        chat_id: msg.chat_id,
        message_text: msg.text!,
        sender_name: msg.sender_name,
      });
      d.activity.push({
        kind: "ai",
        level: "success",
        message: `Gemini respondió en ${d.clock.now().getTime() - aiStart}ms`,
        meta: {
          chat_id: msg.chat_id,
          label: chat?.label ?? null,
          status: result.status,
          preview:
            result.status === "need_info"
              ? `need_info: ${result.missing ?? ""}`
              : result.reply.slice(0, 60),
        },
      });
    } catch (err) {
      const m = (err as Error).message;
      d.logger.error({ err, chat_id: msg.chat_id }, "AI respond failed");
      d.activity.push({
        kind: "ai",
        level: "error",
        message: `Gemini falló tras ${d.clock.now().getTime() - aiStart}ms: ${m}`,
        meta: { chat_id: msg.chat_id },
      });
      return;
    }

    // Abstención: el agente no tiene contexto suficiente. Nunca inventamos ni
    // enviamos (ni en auto-send): se crea un draft "needs_info" para que el dueño
    // responda o agregue el dato faltante a su memoria.
    if (holdForInfo(result)) {
      const draftId = await d.drafts.insert({
        chat_id: msg.chat_id,
        reply_to_id: msg.id,
        content: "",
        kind: "needs_info",
        missing: result.missing,
      });
      d.logger.info(
        { draftId, chat_id: msg.chat_id, missing: result.missing },
        "Need-info draft saved (abstención — falta contexto)"
      );
      d.events.draftCreated({
        id: draftId,
        chat_id: msg.chat_id,
        content: "",
        created_at: d.clock.now().toISOString(),
        kind: "needs_info",
        missing: result.missing,
      });
      d.activity.push({
        kind: "draft",
        level: "warn",
        message: `Falta contexto para responder a ${chat?.name ?? msg.chat_id}${
          result.missing ? `: ${result.missing}` : ""
        }`,
        meta: { chat_id: msg.chat_id, label: chat?.label ?? null, missing: result.missing },
      });
      await this.notifyOwner(msg, chat, result.missing);
      return;
    }

    const reply = result.reply;

    if (deliveryMode(state) === "draft") {
      const draftId = await d.drafts.insert({
        chat_id: msg.chat_id,
        reply_to_id: msg.id,
        content: reply,
      });
      d.logger.info({ draftId, chat_id: msg.chat_id, reply }, "Draft saved (draft_mode=true)");
      d.events.draftCreated({
        id: draftId,
        chat_id: msg.chat_id,
        content: reply,
        created_at: d.clock.now().toISOString(),
      });
      d.activity.push({
        kind: "draft",
        level: "info",
        message: `Borrador #${draftId} listo para ${chat?.name ?? msg.chat_id}`,
        meta: { chat_id: msg.chat_id, label: chat?.label ?? null, preview: reply.slice(0, 80) },
      });
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
      msg.chat_id,
      reply,
      chat?.label ?? null
    );
    d.logger.info({ chat_id: msg.chat_id }, "Reply sent");
  }

  /**
   * Ping the owner over WhatsApp about a need_info abstention. Sends to every
   * chat tagged with OWNER_NOTIFY_LABEL (skipping the chat that triggered it, to
   * avoid double-messaging the same conversation). Best-effort: never throws.
   */
  private async notifyOwner(
    msg: IncomingMessage,
    chat: Chat | null,
    missing: string | null
  ): Promise<void> {
    const d = this.deps;
    let targets;
    try {
      const labeled = await d.chats.list({ label: OWNER_NOTIFY_LABEL, limit: 50 });
      targets = labeled.filter((c) => c.id !== msg.chat_id);
    } catch (err) {
      d.logger.warn({ err }, "notifyOwner: could not list notify chats");
      return;
    }
    if (targets.length === 0) return;

    const who = chat?.name ?? (msg.phone ? `+${msg.phone}` : msg.chat_id);
    const incoming = msg.text?.trim() ?? "";
    const snippet = incoming.length > 140 ? `${incoming.slice(0, 140)}…` : incoming;
    const text =
      `🤖 No supe qué responder.\n` +
      `De: ${who}\n` +
      (snippet ? `Decía: "${snippet}"\n` : "") +
      (missing ? `Me falta: ${missing}\n` : "") +
      `Respóndele tú o agrégalo en mis notas.`;

    for (const t of targets) {
      try {
        await d.whatsapp.sendText(t.id, text);
        d.activity.push({
          kind: "system",
          level: "info",
          message: `Aviso de falta de contexto enviado a ${t.name ?? t.id}`,
          meta: { chat_id: t.id, about: msg.chat_id },
        });
      } catch (err) {
        d.logger.warn({ err, target: t.id }, "notifyOwner: failed to send notification");
      }
    }
  }
}
