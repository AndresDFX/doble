import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { mkdir } from "node:fs/promises";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { pool } from "../db.js";

const MAX_PER_CHAT = Number(process.env.MAX_PER_CHAT ?? 500);
const AI_INGEST_BATCH = 64;
const IDLE_TIMEOUT_MS = Number(process.env.HISTORY_IDLE_MS ?? 60_000);
const HARD_TIMEOUT_MS = Number(process.env.HISTORY_MAX_MS ?? 15 * 60_000);
const QR_WAIT_MS = Number(process.env.QR_WAIT_MS ?? 5 * 60_000);

const LABEL_NAME_NORMALIZE: Record<string, string> = {
  familia: "familia",
  family: "familia",
  trabajo: "trabajo",
  work: "trabajo",
  amigos: "amigos",
  friends: "amigos",
  amor: "amor",
  love: "amor",
};

function normalizeLabel(name: string): string {
  return LABEL_NAME_NORMALIZE[name.toLowerCase().trim()] ?? name.toLowerCase().trim();
}

type IngestItem = {
  message_id: string;
  chat_id: string;
  label: string | null;
  content: string;
};

async function postIngest(items: IngestItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const res = await fetch(`${config.aiServiceUrl}/ingest-history`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    throw new Error(`/ingest-history failed: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { embedded: number }).embedded;
}

function textOf(message: proto.IMessage | null | undefined): string | null {
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  return null;
}

function typeOf(message: proto.IMessage | null | undefined): string {
  if (!message) return "other";
  if (message.conversation || message.extendedTextMessage) return "text";
  if (message.audioMessage) return "audio";
  if (message.imageMessage) return "image";
  if (message.stickerMessage) return "sticker";
  if (message.videoMessage) return "video";
  return "other";
}

async function persistChats(chats: { id: string; name?: string | null }[]) {
  if (chats.length === 0) return;
  const values: unknown[] = [];
  const placeholders = chats.map((c, i) => {
    values.push(c.id, c.name ?? null);
    return `($${i * 2 + 1}, $${i * 2 + 2})`;
  });
  await pool.query(
    `INSERT INTO chats (id, name) VALUES ${placeholders.join(",")}
     ON CONFLICT (id) DO UPDATE SET name = COALESCE(EXCLUDED.name, chats.name)`,
    values
  );
}

async function persistMessages(msgs: proto.IWebMessageInfo[]) {
  const filtered = msgs.filter(
    (m) => m.key.id && m.key.remoteJid && m.message
  );
  if (filtered.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const m of filtered) {
      const ts = m.messageTimestamp
        ? new Date(Number(m.messageTimestamp) * 1000)
        : new Date();
      await client.query(
        `INSERT INTO messages (id, chat_id, from_me, type, content, raw_media_path, ts)
         VALUES ($1, $2, $3, $4, $5, NULL, $6)
         ON CONFLICT (id) DO UPDATE SET content = COALESCE(EXCLUDED.content, messages.content)`,
        [
          m.key.id,
          m.key.remoteJid,
          !!m.key.fromMe,
          typeOf(m.message),
          textOf(m.message),
          ts,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function runEmbeddings() {
  logger.info("Running embeddings on persisted messages");

  const { rows: chats } = await pool.query<{ id: string; label: string | null }>(
    "SELECT id, label FROM chats"
  );
  let total = 0;

  for (const chat of chats) {
    const { rows: msgs } = await pool.query<{
      id: string;
      chat_id: string;
      content: string | null;
    }>(
      `SELECT m.id, m.chat_id, m.content
       FROM messages m
       LEFT JOIN message_embeddings e ON e.message_id = m.id
       WHERE m.chat_id = $1
         AND m.content IS NOT NULL
         AND length(trim(m.content)) > 0
         AND e.message_id IS NULL
       ORDER BY m.ts DESC
       LIMIT $2`,
      [chat.id, MAX_PER_CHAT]
    );

    const items: IngestItem[] = msgs.map((m) => ({
      message_id: m.id,
      chat_id: m.chat_id,
      label: chat.label,
      content: m.content!,
    }));

    for (let i = 0; i < items.length; i += AI_INGEST_BATCH) {
      const batch = items.slice(i, i + AI_INGEST_BATCH);
      const n = await postIngest(batch);
      total += n;
      logger.info(
        { chat_id: chat.id, batchSize: batch.length, embedded: n },
        "Batch embedded"
      );
    }
  }
  logger.info({ total }, "Embeddings done");
}

async function main() {
  await mkdir(config.waSessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(config.waSessionDir);
  const { version } = await fetchLatestBaileysVersion();

  logger.info({ version, MAX_PER_CHAT }, "Starting init-history with full sync");
  logger.warn(
    "Make sure the gateway is NOT running. WhatsApp Web only allows one session per device pairing."
  );

  const labelsById = new Map<string, string>();
  const chatLabels = new Map<string, Set<string>>();

  let chatsPersisted = 0;
  let messagesPersisted = 0;
  let isLatestSeen = false;
  let connectionOpen = false;
  let openedAt: number | null = null;
  let lastActivity = Date.now();
  let sock: WASocket;
  let reconnecting = false;
  let fatalError: Error | null = null;

  function attachListeners(s: WASocket) {
    s.ev.on("creds.update", saveCreds);

    s.ev.on("connection.update", (u) => {
      if (u.qr) {
        logger.info("Scan QR with the WhatsApp number you want the agent to use");
        qrcode.generate(u.qr, { small: true });
      }
      if (u.connection === "open") {
        connectionOpen = true;
        openedAt = Date.now();
        lastActivity = Date.now();
        logger.info("WhatsApp connection open — waiting for history sync");
      }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode ?? 0;
        if (code === DisconnectReason.restartRequired && !reconnecting) {
          reconnecting = true;
          logger.info(
            "Stream restart required after pairing — reconnecting (this is expected)"
          );
          setTimeout(() => {
            sock = makeSocket();
            attachListeners(sock);
            reconnecting = false;
          }, 1000);
        } else if (code === DisconnectReason.loggedOut || code === 401) {
          fatalError = new Error(
            "WhatsApp rejected the session (401). Delete the session and retry:\n" +
              `  Remove-Item -Recurse -Force "${config.waSessionDir}"\n` +
              "  npm run ingest-history"
          );
          logger.error(fatalError.message);
        } else {
          logger.warn({ code, err: u.lastDisconnect?.error }, "Connection closed");
        }
      }
    });

    s.ev.on("messaging-history.set", async ({ chats, messages, isLatest }) => {
      lastActivity = Date.now();
      try {
        if (chats?.length) {
          await persistChats(
            chats.map((c) => ({ id: c.id, name: (c as { name?: string }).name ?? null }))
          );
          chatsPersisted += chats.length;

          for (const c of chats) {
            const labelIds = (c as { labels?: string[] }).labels;
            if (labelIds?.length) {
              chatLabels.set(c.id, new Set(labelIds));
            }
          }
        }
        if (messages?.length) {
          await persistMessages(messages);
          messagesPersisted += messages.length;
        }
        logger.info(
          {
            batchChats: chats?.length ?? 0,
            batchMessages: messages?.length ?? 0,
            chatsPersisted,
            messagesPersisted,
            isLatest,
          },
          "History batch persisted"
        );
        if (isLatest) isLatestSeen = true;
      } catch (err) {
        logger.error({ err }, "Failed to persist history batch");
      }
    });

    s.ev.on("labels.edit", (label) => {
      lastActivity = Date.now();
      if (label.deleted) {
        labelsById.delete(label.id);
      } else if (label.name) {
        labelsById.set(label.id, label.name);
      }
      logger.debug(
        { id: label.id, name: label.name, deleted: label.deleted },
        "Label edited"
      );
    });

    // `labels.association.update` is emitted at runtime by Baileys but is not
    // present in the published BaileysEventMap types, so we register it through
    // a narrowly-typed view of the emitter.
    type LabelAssocUpdate = {
      association: { type: string; chatId: string; labelId: string };
      type: "add" | "remove";
    };
    const ev = s.ev as unknown as {
      on(e: "labels.association.update", cb: (u: LabelAssocUpdate) => void): void;
    };
    ev.on("labels.association.update", (u) => {
      lastActivity = Date.now();
      if (u.association.type !== "chat") return;
      const chatId = u.association.chatId;
      const labelId = u.association.labelId;
      let set = chatLabels.get(chatId);
      if (!set) {
        set = new Set();
        chatLabels.set(chatId, set);
      }
      if (u.type === "add") set.add(labelId);
      else if (u.type === "remove") set.delete(labelId);
    });
  }

  function makeSocket(): WASocket {
    return makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: true,
      markOnlineOnConnect: false,
    });
  }

  sock = makeSocket();
  attachListeners(sock);

  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const interval = setInterval(() => {
      if (fatalError) {
        clearInterval(interval);
        reject(fatalError);
        return;
      }
      const elapsed = Date.now() - startedAt;

      if (!connectionOpen) {
        if (elapsed > QR_WAIT_MS) {
          clearInterval(interval);
          reject(
            new Error(
              `QR not scanned within ${QR_WAIT_MS / 1000}s. ` +
                "Run again and scan promptly from WhatsApp -> Linked devices."
            )
          );
        }
        return;
      }

      const sinceOpen = openedAt ? Date.now() - openedAt : 0;
      const idle = Date.now() - lastActivity;

      if (isLatestSeen && idle > 5000) {
        clearInterval(interval);
        resolve();
      } else if (sinceOpen > 10_000 && idle > IDLE_TIMEOUT_MS) {
        logger.warn(
          { idleMs: idle, sinceOpenMs: sinceOpen },
          "No history activity since connection opened — assuming sync done"
        );
        clearInterval(interval);
        resolve();
      } else if (elapsed > HARD_TIMEOUT_MS) {
        clearInterval(interval);
        reject(new Error(`Hard timeout after ${elapsed}ms`));
      }
    }, 2000);
  });

  logger.info(
    { chatsPersisted, messagesPersisted, labels: labelsById.size, labeledChats: chatLabels.size },
    "History sync complete — applying labels"
  );

  for (const [chatId, labelIds] of chatLabels.entries()) {
    const names = [...labelIds]
      .map((id) => labelsById.get(id))
      .filter((n): n is string => !!n)
      .map(normalizeLabel);
    if (names.length === 0) continue;
    const chosen =
      names.find((n) => ["familia", "trabajo", "amigos", "amor"].includes(n)) ?? names[0];
    await pool.query("UPDATE chats SET label = $1 WHERE id = $2", [chosen, chatId]);
  }

  await runEmbeddings();

  await pool.end();
  await sock.end(undefined);
  logger.info("init-history finished");
  process.exit(0);
}

main().catch(async (err) => {
  logger.fatal({ err }, "init-history failed");
  await pool.end().catch(() => {});
  process.exit(1);
});
