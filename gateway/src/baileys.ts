import {
  default as makeWASocket,
  DisconnectReason,
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
import { getAuthState } from "./infrastructure/auth-state.js";
import {
  attachContactSync,
  maybeResyncAddressBook,
  queueContactName,
} from "./infrastructure/contact-sync.js";
import { setSock, peekSock } from "./infrastructure/whatsapp-socket.js";
import { container } from "./composition/container.js";
import { waStatus } from "./wa-status.js";
import { bus } from "./events.js";
import { activity } from "./activity.js";

/**
 * Bumped on every (re)start. Each socket captures its own value; a socket whose
 * generation is no longer current ignores its late events so we never end up
 * with two live sockets (or duplicate reconnect timers) after a relink/reconnect.
 */
let connectionGen = 0;

/**
 * The latest session's `clearAll` (from getAuthState) — wipes the persisted
 * WhatsApp auth so the next start re-pairs from scratch. Works for BOTH the
 * file store (local/compose) and the DynamoDB store (Render). Set on each
 * startBaileys(); used by the logout handler and the manual relink.
 */
let clearSession: (() => Promise<void>) | null = null;

/**
 * Force a re-pair: drop the current socket, wipe the (now useless) session and
 * boot a fresh one so the admin UI shows a new QR. Triggered manually from
 * POST /api/wa/relink when the connection is stuck.
 */
export async function relinkWhatsApp(): Promise<void> {
  logger.warn("Manual relink requested");
  activity.push({ kind: "wa", level: "warn", message: "Revinculación solicitada — generando QR nuevo…" });
  // Immediately reflect "connecting" in the UI and drop any stale QR, so the
  // dashboard shows progress instead of a dead code while we regenerate.
  waStatus.setConnecting();
  bus.publish({ type: "wa-status", payload: waStatus.get() });
  // Invalidate the live socket so its close event won't fire its own reconnect
  // and race this restart.
  connectionGen++;
  const sock = peekSock();
  if (sock) {
    // Best-effort logout (may reject if already unlinked); cap it so a dead
    // socket can't hang the request, then force-close.
    await Promise.race([
      sock.logout().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    try {
      sock.end(undefined);
    } catch {
      /* already closed */
    }
  }
  if (clearSession) {
    await clearSession().catch((err) => logger.warn({ err }, "relink: clear session failed"));
  }
  await startBaileys();
}

export async function startBaileys(): Promise<void> {
  const myGen = ++connectionGen;
  await mkdir(config.waMediaDir, { recursive: true });

  const { state, saveCreds, clearAll } = await getAuthState({
    sessionDir: config.waSessionDir,
    sessionId: config.waSessionId,
  });
  clearSession = clearAll;
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version, authStore: config.waAuthStore }, "Starting Baileys");

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  setSock(sock);

  sock.ev.on("creds.update", saveCreds);
  attachContactSync(sock);

  sock.ev.on("connection.update", async (update) => {
    // A newer startBaileys() (reconnect or manual relink) has superseded this
    // socket; ignore its trailing events.
    if (myGen !== connectionGen) return;
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logger.info("Scan this QR with WhatsApp -> Linked devices (also shown in the admin UI)");
      qrcode.generate(qr, { small: true });
      waStatus.setQr(qr).catch((err) => logger.warn({ err }, "Failed to encode QR"));
      bus.publish({ type: "wa-status", payload: waStatus.get() });
      activity.push({ kind: "wa", level: "info", message: "QR generado, esperando escaneo" });
    }
    if (connection === "open") {
      logger.info("WhatsApp connection open");
      const meId = sock.user?.id ?? null;
      const meName = sock.user?.name ?? null;
      waStatus.setOpen({ id: meId, name: meName });
      bus.publish({ type: "wa-status", payload: waStatus.get() });
      activity.push({
        kind: "wa",
        level: "success",
        message: `Conexión WhatsApp abierta${meName ? ` (${meName})` : ""}`,
        meta: { id: meId },
      });
      // Populate the address book without re-linking if it looks empty.
      void maybeResyncAddressBook(sock);
    }
    if (connection === "close") {
      const code =
        (lastDisconnect?.error as Boom)?.output?.statusCode ?? 0;
      const loggedOut = code === DisconnectReason.loggedOut;
      logger.warn({ code, loggedOut }, "WhatsApp connection closed");
      waStatus.setClose(lastDisconnect?.error?.message ?? `code ${code}`);
      bus.publish({ type: "wa-status", payload: waStatus.get() });
      activity.push({
        kind: "wa",
        level: "warn",
        message: loggedOut
          ? `Sesión cerrada (code ${code}). Revinculando: se generará un QR nuevo…`
          : `Conexión cerrada (code ${code}). Reintentando…`,
        meta: { code, error: lastDisconnect?.error?.message },
      });
      // Logged out (device unlinked / session invalidated): the stored creds are
      // dead. Clear them — clearAll handles BOTH the file store and the DynamoDB
      // store — so the restart boots WITHOUT creds and emits a fresh QR. Without
      // this, Baileys reloads the dead creds, hits 401 again and never shows a QR.
      // Any other close code keeps the creds and just resumes the session.
      if (loggedOut) {
        await clearAll().catch((err) => logger.warn({ err }, "Failed to clear session"));
      }
      setTimeout(() => {
        // A manual relink may have already restarted; don't double-start.
        if (myGen !== connectionGen) return;
        startBaileys().catch((err) => logger.error({ err }, "Reconnect failed"));
      }, loggedOut ? 750 : 2000);
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
      // Contact identification: fill the chat name from the sender's pushName
      // (lowest precedence — won't overwrite an address-book or manual name).
      if (!msg.key.fromMe && msg.pushName && msg.key.remoteJid) {
        queueContactName(msg.key.remoteJid, msg.pushName, "push");
      }
      try {
        const extracted = await extractMessage(sock, msg);
        if (extracted) {
          await container.processIncomingMessage.execute(extracted, { shouldReply });
        }
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
  phone: string | null;
};

/**
 * Extended WAMessageKey fields. Baileys (6.7.x) populates these from the stanza
 * attrs (`sender_pn`/`participant_pn`) but the base proto type doesn't declare
 * them, so we read them through a local widening type.
 */
type PnKey = { senderPn?: string | null; participantPn?: string | null };

/** Digits-only phone from a JID like "573203510603@s.whatsapp.net" (drops device suffix). */
function digitsFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const user = jid.split("@")[0]?.split(":")[0]?.trim();
  return user && /^\d+$/.test(user) ? user : null;
}

/**
 * Resolve the CONTACT's phone for a 1:1 chat, only from INBOUND messages.
 *
 * For @s.whatsapp.net the number is in the JID; for @lid (a privacy id) WhatsApp
 * only exposes it via key.senderPn when it chooses to attach it — so it may be
 * null until an inbound message carries it. We bail on outbound (fromMe) messages
 * because there key.senderPn is the OWNER's own number, not the contact's, and
 * persisting it would clobber the contact's real phone. Groups (@g.us) and
 * unknown servers yield null.
 */
function phoneFromKey(key: proto.IMessageKey | null | undefined): string | null {
  if (key?.fromMe) return null;
  const remoteJid = key?.remoteJid ?? "";
  if (remoteJid.endsWith("@s.whatsapp.net")) return digitsFromJid(remoteJid);
  if (remoteJid.endsWith("@lid")) {
    const pn = key as (proto.IMessageKey & PnKey) | null;
    return digitsFromJid(pn?.senderPn ?? pn?.participantPn ?? null);
  }
  return null;
}

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
    phone: phoneFromKey(msg.key),
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
