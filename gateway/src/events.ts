import { EventEmitter } from "node:events";

export type AppEvent =
  | { type: "wa-status"; payload: unknown }
  | { type: "message"; payload: { id: string; chat_id: string; from_me: boolean; content: string | null; ts: string } }
  | { type: "draft"; payload: { id: number; chat_id: string; content: string; created_at: string } }
  | { type: "error"; payload: { source: string; message: string; at: string } };

class AppBus extends EventEmitter {
  publish(event: AppEvent): void {
    this.emit("event", event);
  }
}

export const bus = new AppBus();
bus.setMaxListeners(50);
