import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { handleIncoming } from "./handlers/incoming.js";

let currentSock: WASocket | null = null;

export function getSock(): WASocket {
  if (!currentSock) throw new Error("WhatsApp socket not initialized yet");
  return currentSock;
}

export async function startBaileys(): Promise<void> {
  await mkdir(config.waSessionDir, { recursive: true });
  await mkdir(config.waMediaDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(config.waSessionDir);
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version }, "Starting Baileys");

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logger.info("Scan this QR with WhatsApp -> Linked devices");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      logger.info("WhatsApp connection open");
    }
    if (connection === "close") {
      const code =
        (lastDisconnect?.error as Boom)?.output?.statusCode ?? 0;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn({ code, shouldReconnect }, "WhatsApp connection closed");
      if (shouldReconnect) {
        setTimeout(() => {
          startBaileys().catch((err) =>
            logger.error({ err }, "Reconnect failed")
          );
        }, 2000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    logger.info(
      {
        type,
        count: messages.length,
        firstChat: messages[0]?.key.remoteJid,
        firstFromMe: messages[0]?.key.fromMe,
      },
      "messages.upsert received"
    );
    if (type !== "notify" && type !== "append") return;
    const shouldReply = type === "notify";
    for (const msg of messages) {
      try {
        await handleIncoming(sock, msg, { shouldReply });
      } catch (err) {
        logger.error({ err, key: msg.key }, "Failed to handle message");
      }
    }
  });
}

export type ExtractedMessage = {
  id: string;
  chat_id: string;
  from_me: boolean;
  sender_name: string | null;
  ts: Date;
  type: "text" | "audio" | "image" | "sticker" | "video" | "other";
  text: string | null;
  mediaPath: string | null;
};

export async function extractMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo
): Promise<ExtractedMessage | null> {
  if (!msg.key.id || !msg.key.remoteJid) return null;

  const message = msg.message;
  if (!message) return null;

  const ts = msg.messageTimestamp
    ? new Date(Number(msg.messageTimestamp) * 1000)
    : new Date();

  const base = {
    id: msg.key.id,
    chat_id: msg.key.remoteJid,
    from_me: !!msg.key.fromMe,
    sender_name: msg.pushName ?? null,
    ts,
  };

  if (message.conversation) {
    return { ...base, type: "text", text: message.conversation, mediaPath: null };
  }
  if (message.extendedTextMessage?.text) {
    return {
      ...base,
      type: "text",
      text: message.extendedTextMessage.text,
      mediaPath: null,
    };
  }
  if (message.audioMessage) {
    const path = await downloadToFile(sock, msg, "audio.ogg");
    return { ...base, type: "audio", text: null, mediaPath: path };
  }
  if (message.imageMessage) {
    const path = await downloadToFile(sock, msg, "image.jpg");
    return {
      ...base,
      type: "image",
      text: message.imageMessage.caption ?? null,
      mediaPath: path,
    };
  }
  if (message.stickerMessage) {
    const path = await downloadToFile(sock, msg, "sticker.webp");
    return { ...base, type: "sticker", text: null, mediaPath: path };
  }
  if (message.videoMessage) {
    return {
      ...base,
      type: "video",
      text: message.videoMessage.caption ?? null,
      mediaPath: null,
    };
  }
  return { ...base, type: "other", text: null, mediaPath: null };
}

async function downloadToFile(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  suffix: string
): Promise<string | null> {
  try {
    const buf = (await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: logger as any, reuploadRequest: sock.updateMediaMessage }
    )) as Buffer;
    const filename = `${randomUUID()}-${suffix}`;
    const path = join(config.waMediaDir, filename);
    await writeFile(path, buf);
    return path;
  } catch (err) {
    logger.error({ err }, "Failed to download media");
    return null;
  }
}
