/**
 * Thin adapters that expose the existing infrastructure singletons (event bus,
 * activity ring buffer, pino logger, the system clock) as domain ports.
 */
import { bus } from "../events.js";
import { activity } from "../activity.js";
import { logger } from "../logger.js";
import type { ActivityLog, AppLogger, Clock, EventPublisher } from "../domain/ports.js";

export class BusEventPublisher implements EventPublisher {
  messageStored(payload: {
    id: string;
    chat_id: string;
    from_me: boolean;
    content: string | null;
    ts: string;
  }): void {
    bus.publish({ type: "message", payload });
  }

  draftCreated(payload: {
    id: number;
    chat_id: string;
    content: string;
    created_at: string;
  }): void {
    bus.publish({ type: "draft", payload });
  }
}

export class ActivityLogAdapter implements ActivityLog {
  push(entry: Parameters<ActivityLog["push"]>[0]): void {
    activity.push(entry);
  }
}

type LogFn = (obj: unknown, msg?: string) => void;

export const appLogger: AppLogger = {
  debug: (logger.debug.bind(logger) as LogFn),
  info: (logger.info.bind(logger) as LogFn),
  warn: (logger.warn.bind(logger) as LogFn),
  error: (logger.error.bind(logger) as LogFn),
};

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
