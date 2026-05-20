import type { WASocket, proto } from "@whiskeysockets/baileys";
import { extractMessage } from "../baileys.js";
import {
  insertMessage,
  upsertChat,
  getChat,
  getAgentState,
  insertDraft,
  updateMessageContent,
} from "../db.js";
import { aiRespond, aiTranscribe, aiEmbedAndStore } from "../ai-client.js";
import { logger } from "../logger.js";
import { sendText } from "./outgoing.js";
import { bus } from "../events.js";
import { activity } from "../activity.js";

export async function handleIncoming(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  opts: { shouldReply: boolean } = { shouldReply: true }
): Promise<void> {
  const extracted = await extractMessage(sock, msg);
  if (!extracted) return;

  await upsertChat({ id: extracted.chat_id });

  await insertMessage({
    id: extracted.id,
    chat_id: extracted.chat_id,
    from_me: extracted.from_me,
    type: extracted.type,
    content: extracted.text,
    raw_media_path: extracted.mediaPath,
    ts: extracted.ts,
  });

  bus.publish({
    type: "message",
    payload: {
      id: extracted.id,
      chat_id: extracted.chat_id,
      from_me: extracted.from_me,
      content: extracted.text,
      ts: extracted.ts.toISOString(),
    },
  });

  activity.push({
    kind: extracted.from_me ? "message-out" : "message-in",
    level: "info",
    message: `${extracted.from_me ? "→" : "←"} ${extracted.type} ${extracted.text ? `"${extracted.text.slice(0, 80)}"` : "(sin texto)"}`,
    meta: { chat_id: extracted.chat_id, type: extracted.type, sender: extracted.sender_name },
  });

  if (extracted.from_me) {
    logger.debug({ id: extracted.id }, "Own message — stored, no reply");
    return;
  }

  if (extracted.type === "audio" && extracted.mediaPath) {
    try {
      const text = await aiTranscribe(extracted.mediaPath);
      await updateMessageContent(extracted.id, text);
      extracted.text = text;
      logger.info({ id: extracted.id, text }, "Audio transcribed");
    } catch (err) {
      logger.error({ err, id: extracted.id }, "Transcription failed");
      return;
    }
  }

  if (!extracted.text) {
    logger.debug(
      { id: extracted.id, type: extracted.type },
      "No text content — skipping reply"
    );
    return;
  }

  const chat = await getChat(extracted.chat_id);

  void aiEmbedAndStore({
    message_id: extracted.id,
    chat_id: extracted.chat_id,
    label: chat?.label ?? null,
    content: extracted.text,
  }).catch((err) =>
    logger.warn({ err, id: extracted.id }, "Failed to embed incoming message")
  );

  if (!opts.shouldReply) {
    logger.debug({ id: extracted.id }, "Persist-only (replayed offline message)");
    return;
  }

  const state = await getAgentState();
  if (!state.enabled) {
    logger.debug("Agent globally disabled");
    return;
  }

  if (chat && !chat.agent_enabled) {
    logger.debug({ chat_id: extracted.chat_id }, "Agent disabled for this chat");
    return;
  }

  let reply: string;
  const aiStart = Date.now();
  try {
    const result = await aiRespond({
      chat_id: extracted.chat_id,
      message_text: extracted.text,
      sender_name: extracted.sender_name,
    });
    reply = result.reply;
    activity.push({
      kind: "ai",
      level: "success",
      message: `Gemini respondió en ${Date.now() - aiStart}ms`,
      meta: { chat_id: extracted.chat_id, label: chat?.label ?? null, preview: reply.slice(0, 60) },
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err, chat_id: extracted.chat_id }, "AI respond failed");
    activity.push({
      kind: "ai",
      level: "error",
      message: `Gemini falló tras ${Date.now() - aiStart}ms: ${msg}`,
      meta: { chat_id: extracted.chat_id },
    });
    return;
  }

  if (state.draft_mode) {
    const draftId = await insertDraft({
      chat_id: extracted.chat_id,
      reply_to_id: extracted.id,
      content: reply,
    });
    logger.info(
      { draftId, chat_id: extracted.chat_id, reply },
      "Draft saved (draft_mode=true)"
    );
    bus.publish({
      type: "draft",
      payload: {
        id: draftId,
        chat_id: extracted.chat_id,
        content: reply,
        created_at: new Date().toISOString(),
      },
    });
    activity.push({
      kind: "draft",
      level: "info",
      message: `Borrador #${draftId} listo para ${chat?.name ?? extracted.chat_id}`,
      meta: { chat_id: extracted.chat_id, label: chat?.label ?? null, preview: reply.slice(0, 80) },
    });
    return;
  }

  await sendText(sock, extracted.chat_id, reply, chat?.label ?? null);
  logger.info({ chat_id: extracted.chat_id }, "Reply sent");
}
