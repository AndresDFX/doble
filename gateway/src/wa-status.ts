import { EventEmitter } from "node:events";
import QRCode from "qrcode";

export type WaConnection = "connecting" | "open" | "close";

export type WaStatusSnapshot = {
  connection: WaConnection;
  qr: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  lastChangeAt: string;
  me: { id: string | null; name: string | null };
};

class WaStatusStore extends EventEmitter {
  private snapshot: WaStatusSnapshot = {
    connection: "close",
    qr: null,
    qrDataUrl: null,
    lastError: null,
    lastChangeAt: new Date().toISOString(),
    me: { id: null, name: null },
  };

  get(): WaStatusSnapshot {
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

  private update(patch: Partial<WaStatusSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      lastChangeAt: new Date().toISOString(),
    };
    this.emit("change", this.snapshot);
  }
}

export const waStatus = new WaStatusStore();
