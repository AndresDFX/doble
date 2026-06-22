/**
 * Contact identification — ported from the telegram-sender reference.
 *
 * Harvests contact names from WhatsApp events and persists them onto the
 * `chats.name` column so the agent can address people by their real name
 * without a manual edit. Precedence (never clobbers a manual edit):
 *   phonebook name ('contact') > self-reported notify/verifiedName + pushName ('push').
 *
 * Names arrive in bursts (the address book lands on initial link via
 * `messaging-history.set`), so writes are buffered and flushed with a debounce.
 */
import type { WASocket } from "@whiskeysockets/baileys";
import type { ContactNameRecord, ContactNameSource } from "../domain/entities.js";
import { container } from "../composition/container.js";
import { logger } from "../logger.js";
import { activity } from "../activity.js";

type RawContact = {
  id?: string | null;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
};

const PRIO: Record<ContactNameSource, number> = { manual: 3, contact: 2, push: 1 };
const FLUSH_MS = 2000;

const buffer = new Map<string, ContactNameRecord>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Person chats only — never harvest names for groups (@g.us) or broadcasts. */
function isPersonJid(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

/** Buffer one name, keeping the highest-precedence value seen for that jid. */
export function queueContactName(
  id: string | null | undefined,
  name: string | null | undefined,
  source: ContactNameSource
): void {
  if (!id || !name || !isPersonJid(id)) return;
  const clean = name.trim();
  if (!clean) return;
  const prev = buffer.get(id);
  if (!prev || PRIO[source] >= PRIO[prev.source]) buffer.set(id, { id, name: clean, source });
  schedule();
}

/** Map a Baileys contact: phonebook `name` wins; otherwise self-reported name fills the gap. */
export function recordContact(c: RawContact): void {
  if (!c?.id) return;
  if (c.name) queueContactName(c.id, c.name, "contact");
  else queueContactName(c.id, c.notify ?? c.verifiedName, "push");
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    void flush();
  }, FLUSH_MS);
}

async function flush(): Promise<void> {
  timer = null;
  if (buffer.size === 0) return;
  const list = [...buffer.values()];
  buffer.clear();
  try {
    const written = await container.chats.recordContactNames(list);
    logger.info({ queued: list.length, written }, "Contact names persisted");
    if (written > 0) {
      activity.push({
        kind: "system",
        level: "info",
        message: `Identificados ${written} contacto(s) por nombre`,
      });
    }
  } catch (err) {
    logger.warn({ err }, "Failed to persist contact names — re-queuing");
    for (const r of list) if (!buffer.has(r.id)) buffer.set(r.id, r);
    schedule();
  }
}

/**
 * Subscribe a socket to the contact-bearing events. Call once per socket.
 * pushName from inbound messages is captured separately in the messages.upsert
 * handler (it already iterates them there).
 */
export function attachContactSync(sock: WASocket): void {
  sock.ev.on("contacts.upsert", (cs) => cs.forEach(recordContact));
  sock.ev.on("contacts.update", (cs) => cs.forEach((c) => recordContact(c as RawContact)));
  sock.ev.on("messaging-history.set", ({ contacts }) => (contacts ?? []).forEach(recordContact));
}

/**
 * If the address book looks empty (few named chats), force an app-state resync
 * to pull contacts + names WITHOUT re-linking. Best-effort. Once names are
 * persisted, the count climbs and this becomes a no-op. Faithful to the reference.
 */
export async function maybeResyncAddressBook(sock: WASocket): Promise<void> {
  try {
    const named = await container.chats.countNamed();
    if (named >= 50) return;
    logger.info({ named }, "Few named chats — resyncing WhatsApp address book");
    await sock.resyncAppState(
      ["critical_unblock_low", "critical_block", "regular_high", "regular_low", "regular"] as any,
      true
    );
  } catch (err) {
    logger.warn({ err }, "resyncAppState failed");
  }
}
