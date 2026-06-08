/**
 * The core use case: process one inbound WhatsApp message.
 *
 * Orchestrates persistence, transcription, embedding, the reply decision, and
 * delivery (draft vs auto-send) — entirely through domain ports, with the pure
 * rules delegated to `reply-policy`. Knows nothing about Baileys, Fastify, or
 * Postgres.
 */
import type { IncomingMessage } from "../domain/entities.js";
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
  isOwnMessage,
  needsTranscription,
} from "../domain/reply-policy.js";
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

    await d.chats.upsert({ id: msg.chat_id });
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

    let reply: string;
    const aiStart = d.clock.now().getTime();
    try {
      const result = await d.ai.respond({
        chat_id: msg.chat_id,
        message_text: msg.text!,
        sender_name: msg.sender_name,
      });
      reply = result.reply;
      d.activity.push({
        kind: "ai",
        level: "success",
        message: `Gemini respondió en ${d.clock.now().getTime() - aiStart}ms`,
        meta: { chat_id: msg.chat_id, label: chat?.label ?? null, preview: reply.slice(0, 60) },
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
}
