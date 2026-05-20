import { bus } from "./events.js";

export type ActivityKind =
  | "wa"
  | "sender"
  | "message-in"
  | "message-out"
  | "draft"
  | "ai"
  | "batch"
  | "system"
  | "error";

export type ActivityLevel = "info" | "success" | "warn" | "error";

export type Activity = {
  id: number;
  ts: string;
  kind: ActivityKind;
  level: ActivityLevel;
  message: string;
  meta?: Record<string, unknown>;
};

const MAX_BUFFER = 500;

class ActivityStore {
  private buffer: Activity[] = [];
  private nextId = 1;

  push(input: Omit<Activity, "id" | "ts">): Activity {
    const item: Activity = {
      id: this.nextId++,
      ts: new Date().toISOString(),
      ...input,
    };
    this.buffer.unshift(item);
    if (this.buffer.length > MAX_BUFFER) this.buffer.length = MAX_BUFFER;
    bus.publish({ type: "activity", payload: item });
    return item;
  }

  list(limit = 200, kind?: ActivityKind): Activity[] {
    const filtered = kind ? this.buffer.filter((a) => a.kind === kind) : this.buffer;
    return filtered.slice(0, limit);
  }

  clear(): void {
    this.buffer = [];
  }
}

export const activity = new ActivityStore();
