import { EventEmitter } from "node:events";

export type AppEvent =
  | { type: "wa-status"; payload: unknown }
  | { type: "sender-status"; payload: unknown }
  | { type: "message"; payload: { id: string; chat_id: string; from_me: boolean; content: string | null; ts: string } }
  | { type: "draft"; payload: { id: number; chat_id: string; content: string; created_at: string } }
  | { type: "activity"; payload: unknown }
  | { type: "batch-progress"; payload: { batchId: string; index: number; total: number; theme: string; text: string; status: "sent" | "failed"; error?: string } }
  | { type: "batch-state"; payload: { batchId: string | null; status: "idle" | "running" | "done" | "failed"; total?: number; sent?: number; failed?: number } }
  | { type: "error"; payload: { source: string; message: string; at: string } };

class AppBus extends EventEmitter {
  publish(event: AppEvent): void {
    this.emit("event", event);
  }
}

export const bus = new AppBus();
bus.setMaxListeners(50);
