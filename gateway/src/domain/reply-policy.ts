/**
 * Reply policy: the pure business rules of the incoming-message pipeline.
 *
 * No I/O, no framework types — just decisions over domain data. Extracted from
 * the old `handleIncoming` so the rules can be reasoned about (and unit-tested)
 * independently of Baileys, Postgres, or the AI service.
 */
import type { AgentState, Chat, IncomingMessage } from "./entities.js";

/** Own (outgoing) messages are stored for context but never answered. */
export function isOwnMessage(msg: IncomingMessage): boolean {
  return msg.from_me;
}

/** Audio with downloaded media must be transcribed before it has usable text. */
export function needsTranscription(msg: IncomingMessage): boolean {
  return msg.type === "audio" && msg.mediaPath !== null;
}

/** Only messages with text content are embedded and answered. */
export function hasText(msg: IncomingMessage): boolean {
  return Boolean(msg.text);
}

export type ReplyDecision =
  | { reply: true }
  | { reply: false; reason: "agent-disabled" | "chat-disabled" };

/**
 * Whether the agent should generate a reply for this chat. The global switch
 * wins; an unknown chat (null) is allowed by default — only an explicit
 * per-chat opt-out suppresses replies.
 */
export function decideReply(state: AgentState, chat: Chat | null): ReplyDecision {
  if (!state.enabled) return { reply: false, reason: "agent-disabled" };
  if (chat && !chat.agent_enabled) return { reply: false, reason: "chat-disabled" };
  return { reply: true };
}

export type DeliveryMode = "draft" | "send";

/** Draft mode saves replies for review; otherwise they are sent automatically. */
export function deliveryMode(state: AgentState): DeliveryMode {
  return state.draft_mode ? "draft" : "send";
}

/**
 * The model abstained — it lacks grounding to answer this without inventing.
 * Such replies are NEVER sent (even in auto-send): they surface to the owner as
 * a "needs_info" draft so a real answer can be supplied.
 */
export function holdForInfo(result: { status: "answer" | "need_info" }): boolean {
  return result.status === "need_info";
}
