/**
 * Shared "deliver a reply" step: send via WhatsApp, persist the outgoing
 * message, publish it, and embed it for RAG (fire-and-forget). Used by both the
 * incoming-message pipeline (auto-send mode) and the manual "send draft" flow.
 */
import type {
  AiService,
  AppLogger,
  Clock,
  EventPublisher,
  MessageRepository,
  WhatsAppGateway,
} from "../domain/ports.js";

export type ReplyDeliveryDeps = {
  whatsapp: WhatsAppGateway;
  messages: MessageRepository;
  ai: AiService;
  events: EventPublisher;
  clock: Clock;
  logger: AppLogger;
};

export async function deliverReply(
  deps: ReplyDeliveryDeps,
  chatId: string,
  text: string,
  label: string | null = null
): Promise<void> {
  const sent = await deps.whatsapp.sendText(chatId, text);
  if (!sent) {
    deps.logger.warn({ chatId }, "Send did not return a key id");
    return;
  }

  const sentAt = deps.clock.now();
  await deps.messages.insert({
    id: sent.id,
    chat_id: chatId,
    from_me: true,
    type: "text",
    content: text,
    raw_media_path: null,
    ts: sentAt,
  });

  deps.events.messageStored({
    id: sent.id,
    chat_id: chatId,
    from_me: true,
    content: text,
    ts: sentAt.toISOString(),
  });

  void deps.ai
    .embedAndStore({ message_id: sent.id, chat_id: chatId, label, content: text })
    .catch((err) => deps.logger.warn({ err, id: sent.id }, "Failed to embed outgoing message"));
}
