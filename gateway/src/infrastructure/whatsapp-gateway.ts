/**
 * Baileys outbound messaging adapter (implements `WhatsAppGateway`).
 *
 * Owns the human-cadence anti-ban behaviour: a random 2–8s pre-send delay plus
 * a "composing" presence proportional to text length. This MUST stay — it is a
 * critical rule that protects the number from being flagged.
 */
import { getSock } from "./whatsapp-socket.js";
import type { WhatsAppGateway } from "../domain/ports.js";

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 8000;

function humanDelay(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

export class BaileysWhatsAppGateway implements WhatsAppGateway {
  async sendText(chatId: string, text: string): Promise<{ id: string } | null> {
    const sock = getSock();

    await new Promise((r) => setTimeout(r, humanDelay()));

    await sock.sendPresenceUpdate("composing", chatId);
    const typingMs = Math.min(text.length * 50, 5000);
    await new Promise((r) => setTimeout(r, typingMs));
    await sock.sendPresenceUpdate("paused", chatId);

    const sent = await sock.sendMessage(chatId, { text });
    if (!sent?.key?.id) return null;
    return { id: sent.key.id };
  }
}
