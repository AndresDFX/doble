/**
 * Retry pending "need_info" drafts after the owner adds context (e.g. a note).
 *
 * When the agent abstained (need_info) it left a draft pinned to the question
 * that triggered it. Once the owner feeds new context, we re-ask the AI for each
 * pending need_info question; if it can now answer, we resolve the abstention
 * draft and deliver the answer per the current delivery mode (draft vs auto-send)
 * — so the owner doesn't have to wait for the contact to insist again.
 */
import type {
  AgentStateRepository,
  AiService,
  AppLogger,
  ActivityLog,
  Clock,
  DraftRepository,
  EventPublisher,
  MessageRepository,
  WhatsAppGateway,
} from "../domain/ports.js";
import { deliveryMode } from "../domain/reply-policy.js";
import { deliverReply } from "./reply-delivery.js";

export type RetryNeedInfoDeps = {
  drafts: DraftRepository;
  messages: MessageRepository;
  agentState: AgentStateRepository;
  ai: AiService;
  whatsapp: WhatsAppGateway;
  events: EventPublisher;
  activity: ActivityLog;
  clock: Clock;
  logger: AppLogger;
};

export class RetryNeedInfo {
  constructor(private readonly deps: RetryNeedInfoDeps) {}

  /** Re-evaluate every pending need_info draft against the (now richer) context. */
  async run(): Promise<void> {
    const d = this.deps;
    const pending = await d.drafts.list({ status: "pending", limit: 100 });
    const needInfo = pending.filter((x) => x.kind === "needs_info");
    if (needInfo.length === 0) return;

    const mode = deliveryMode(await d.agentState.get());

    for (const draft of needInfo) {
      if (!draft.reply_to_id) continue;
      const question = await d.messages.getContent(draft.reply_to_id);
      if (!question) continue;

      let result: { status: "answer" | "need_info"; reply: string; missing: string | null };
      try {
        result = await d.ai.respond({
          chat_id: draft.chat_id,
          message_text: question,
          sender_name: draft.chat_name,
        });
      } catch (err) {
        d.logger.warn({ err, draftId: draft.id }, "retry-need-info: respond failed");
        continue;
      }

      // Still missing context — leave the abstention draft as-is.
      const reply = result.reply.trim();
      if (result.status !== "answer" || !reply) continue;

      if (mode === "send") {
        await deliverReply(
          {
            whatsapp: d.whatsapp,
            messages: d.messages,
            ai: d.ai,
            events: d.events,
            clock: d.clock,
            logger: d.logger,
          },
          draft.chat_id,
          reply,
          draft.chat_label
        );
        await d.drafts.delete(draft.id);
        d.activity.push({
          kind: "ai",
          level: "success",
          message: `Contexto agregado → respondí lo pendiente a ${draft.chat_name ?? draft.chat_id}`,
          meta: { chat_id: draft.chat_id, preview: reply.slice(0, 60) },
        });
      } else {
        // Draft mode: turn the abstention into a ready-to-send reply draft.
        const newId = await d.drafts.insert({
          chat_id: draft.chat_id,
          reply_to_id: draft.reply_to_id,
          content: reply,
          kind: "reply",
        });
        await d.drafts.delete(draft.id);
        d.events.draftCreated({
          id: newId,
          chat_id: draft.chat_id,
          content: reply,
          created_at: d.clock.now().toISOString(),
        });
        d.activity.push({
          kind: "draft",
          level: "success",
          message: `Contexto agregado → borrador listo para ${draft.chat_name ?? draft.chat_id}`,
          meta: { chat_id: draft.chat_id, preview: reply.slice(0, 60) },
        });
      }
    }
  }
}
