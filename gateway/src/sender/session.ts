import {
  default as makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { resolve } from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getAuthState } from "../infrastructure/auth-state.js";
import { bus } from "../events.js";
import { activity } from "../activity.js";
import { senderStatus } from "./status.js";

// Where the sender session lives depends on WA_AUTH_STORE (same factory as the
// main session): `files` → this directory on disk; `dynamo` → items namespaced
// under `sender::` in WA_AUTH_TABLE, so it survives restarts on ephemeral disks.
const SENDER_SESSION_DIR = resolve(config.waSessionDir, "..", ".wa-sender-session");
const SENDER_SESSION_ID = "sender";

let currentSock: WASocket | null = null;
let reconnecting = false;
let connectPromise: Promise<void> | null = null;

/**
 * The latest session's `clearAll` (from getAuthState) — wipes the persisted
 * sender auth in whichever store is configured (files or DynamoDB). Set on
 * each startSender(); used by purgeSenderSession().
 */
let clearSenderSession: (() => Promise<void>) | null = null;

export function getSenderSessionDir(): string {
  return SENDER_SESSION_DIR;
}

export function getSenderSock(): WASocket {
  if (!currentSock) throw new Error("Sender session not connected");
  return currentSock;
}

export function senderIsOpen(): boolean {
  return senderStatus.get().connection === "open" && currentSock !== null;
}

export async function startSender(): Promise<void> {
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    const { state, saveCreds, clearAll } = await getAuthState({
      sessionDir: SENDER_SESSION_DIR,
      sessionId: SENDER_SESSION_ID,
    });
    clearSenderSession = clearAll;
    const { version } = await fetchLatestBaileysVersion();

    const makeSock = (): WASocket =>
      makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

    const attach = (s: WASocket): void => {
      s.ev.on("creds.update", saveCreds);
      s.ev.on("connection.update", (u) => {
        if (u.qr) {
          senderStatus.setQr(u.qr).catch((err) =>
            logger.warn({ err }, "Failed to encode sender QR")
          );
          bus.publish({ type: "sender-status", payload: senderStatus.get() });
          activity.push({
            kind: "sender",
            level: "info",
            message: "QR del sender listo. Escanéa desde WhatsApp A.",
          });
        }
        if (u.connection === "open") {
          const me = { id: s.user?.id ?? null, name: s.user?.name ?? null };
          senderStatus.setOpen(me);
          bus.publish({ type: "sender-status", payload: senderStatus.get() });
          activity.push({
            kind: "sender",
            level: "success",
            message: `Sender conectado${me.name ? ` (${me.name})` : ""}`,
            meta: { id: me.id },
          });
        }
        if (u.connection === "close") {
          const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode ?? 0;
          if (code === DisconnectReason.restartRequired && !reconnecting) {
            reconnecting = true;
            activity.push({
              kind: "sender",
              level: "info",
              message: "Sender pidió restart (esperado tras pairing). Reconectando…",
            });
            setTimeout(() => {
              currentSock = makeSock();
              attach(currentSock);
              reconnecting = false;
            }, 1000);
          } else if (code === DisconnectReason.loggedOut || code === 401) {
            senderStatus.setClose("Sesión rechazada (401). Borra la sesión del sender y reintenta.");
            bus.publish({ type: "sender-status", payload: senderStatus.get() });
            activity.push({
              kind: "sender",
              level: "error",
              message: "Sesión del sender rechazada (401). Hay que repararse.",
            });
          } else {
            senderStatus.setClose(u.lastDisconnect?.error?.message ?? `code ${code}`);
            bus.publish({ type: "sender-status", payload: senderStatus.get() });
          }
        }
      });
    };

    currentSock = makeSock();
    attach(currentSock);
  })();

  try {
    await connectPromise;
  } finally {
    connectPromise = null;
  }
}

export async function stopSender(): Promise<void> {
  if (currentSock) {
    try {
      await currentSock.end(undefined);
    } catch {}
    currentSock = null;
  }
  senderStatus.setIdle();
  bus.publish({ type: "sender-status", payload: senderStatus.get() });
  activity.push({ kind: "sender", level: "info", message: "Sender desconectado" });
}

export async function purgeSenderSession(): Promise<void> {
  await stopSender();
  // clearAll() wipes the session in whichever store is active (files or Dynamo).
  // If the sender never connected in this process there's no handle yet — grab
  // a fresh one from the factory just to clear.
  const clearAll =
    clearSenderSession ??
    (await getAuthState({ sessionDir: SENDER_SESSION_DIR, sessionId: SENDER_SESSION_ID })).clearAll;
  await clearAll();
  clearSenderSession = null;
  activity.push({
    kind: "sender",
    level: "warn",
    message: "Sesión del sender borrada. Próxima conexión pedirá QR nuevo.",
  });
}
