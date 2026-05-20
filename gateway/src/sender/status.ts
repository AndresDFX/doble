import { EventEmitter } from "node:events";
import QRCode from "qrcode";

export type SenderConnection = "idle" | "connecting" | "open" | "close";

export type SenderStatusSnapshot = {
  connection: SenderConnection;
  qr: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  lastChangeAt: string;
  me: { id: string | null; name: string | null };
};

class SenderStatusStore extends EventEmitter {
  private snapshot: SenderStatusSnapshot = {
    connection: "idle",
    qr: null,
    qrDataUrl: null,
    lastError: null,
    lastChangeAt: new Date().toISOString(),
    me: { id: null, name: null },
  };

  get(): SenderStatusSnapshot {
    return this.snapshot;
  }

  async setQr(qr: string): Promise<void> {
    const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    this.update({ qr, qrDataUrl, connection: "connecting", lastError: null });
  }

  setOpen(me: { id: string | null; name: string | null }): void {
    this.update({ connection: "open", qr: null, qrDataUrl: null, lastError: null, me });
  }

  setClose(error: string | null): void {
    this.update({ connection: "close", lastError: error });
  }

  setIdle(): void {
    this.update({ connection: "idle", qr: null, qrDataUrl: null, lastError: null });
  }

  private update(patch: Partial<SenderStatusSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      lastChangeAt: new Date().toISOString(),
    };
    this.emit("change", this.snapshot);
  }
}

export const senderStatus = new SenderStatusStore();
