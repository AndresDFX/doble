/**
 * Proactive-messaging policy: the pure rules for the scheduled, unprompted
 * messages the agent sends on its own.
 *
 * No I/O, no framework types — just decisions and arithmetic over domain data,
 * so they can be unit-tested without Postgres, Baileys or the AI service.
 * Mirrors telegram-sender's `domain/scheduling.py:delay_aleatorio` (random
 * delay in a [min, max] range) adapted to "every N minutes per chat".
 */
import type { AgentState, Chat } from "./entities.js";

/** Hard bounds for a per-chat interval, in minutes (1 minute … 24 hours). */
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 1440;

/** Coerce any number into an integer within [MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES]. */
export function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return MIN_INTERVAL_MINUTES;
  const r = Math.round(n);
  if (r < MIN_INTERVAL_MINUTES) return MIN_INTERVAL_MINUTES;
  if (r > MAX_INTERVAL_MINUTES) return MAX_INTERVAL_MINUTES;
  return r;
}

/**
 * A random whole number of minutes in [min, max] (inclusive). Tolerates a
 * reversed range (auto-swaps) and out-of-bound values (clamps), so a bad config
 * can never produce a 0-or-negative interval that would hot-loop the scheduler.
 * `rng` returns a float in [0, 1); injectable for deterministic tests.
 */
export function randomIntervalMinutes(
  min: number,
  max: number,
  rng: () => number = Math.random
): number {
  let lo = clampMinutes(min);
  let hi = clampMinutes(max);
  if (hi < lo) [lo, hi] = [hi, lo];
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** When the next proactive send for this chat should happen: now + random(min, max) minutes. */
export function nextProactiveAt(
  now: Date,
  min: number,
  max: number,
  rng: () => number = Math.random
): Date {
  const minutes = randomIntervalMinutes(min, max, rng);
  return new Date(now.getTime() + minutes * 60_000);
}

export type ProactiveDecision =
  | { ok: true }
  | { ok: false; reason: "agent-disabled" | "chat-disabled" | "proactive-disabled" };

/**
 * Whether a proactive message may be generated for this chat. The global switch
 * wins, then the per-chat agent switch, then the per-chat proactive opt-in.
 * Unlike `decideReply`, the chat is required (a proactive send always targets a
 * known, configured chat).
 */
export function decideProactive(state: AgentState, chat: Chat): ProactiveDecision {
  if (!state.enabled) return { ok: false, reason: "agent-disabled" };
  if (!chat.agent_enabled) return { ok: false, reason: "chat-disabled" };
  if (!chat.proactive_enabled) return { ok: false, reason: "proactive-disabled" };
  return { ok: true };
}
