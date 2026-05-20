import type { WASocket } from "@whiskeysockets/baileys";
import { insertMessage } from "../db.js";
import { aiEmbedAndStore } from "../ai-client.js";
import { logger } from "../logger.js";

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 8000;

function humanDelay(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

export async function sendText(
  sock: WASocket,
  chatId: string,
  text: string,
  label: string | null = null
): Promise<void> {
  const delay = humanDelay();
  logger.debug({ chatId, delay }, "Sleeping before send (human cadence)");
  await new Promise((r) => setTimeout(r, delay));

  await sock.sendPresenceUpdate("composing", chatId);
  const typingMs = Math.min(text.length * 50, 5000);
  await new Promise((r) => setTimeout(r, typingMs));
  await sock.sendPresenceUpdate("paused", chatId);

  const sent = await sock.sendMessage(chatId, { text });
  if (!sent?.key?.id) {
    logger.warn({ chatId }, "Send did not return a key id");
    return;
  }

  await insertMessage({
    id: sent.key.id,
    chat_id: chatId,
    from_me: true,
    type: "text",
    content: text,
    raw_media_path: null,
    ts: new Date(),
  });

  void aiEmbedAndStore({
    message_id: sent.key.id,
    chat_id: chatId,
    label,
    content: text,
  }).catch((err) =>
    logger.warn({ err, id: sent.key.id }, "Failed to embed outgoing message")
  );
}
