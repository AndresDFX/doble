import type { WASocket } from "@whiskeysockets/baileys";

/**
 * Holds the live Baileys socket so the messaging gateway and the session
 * module can share it without a circular import. The session sets it on
 * connect; adapters read it at call time.
 */
let currentSock: WASocket | null = null;

export function setSock(sock: WASocket): void {
  currentSock = sock;
}

export function getSock(): WASocket {
  if (!currentSock) throw new Error("WhatsApp socket not initialized yet");
  return currentSock;
}
