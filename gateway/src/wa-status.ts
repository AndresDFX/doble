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

  /**
   * Enter the "connecting" state and drop any stale QR. Called at the start of a
   * manual relink so the UI immediately shows progress (and never a dead QR from
   * a previous session) while a fresh QR is generated.
   */
  setConnecting(): void {
    this.update({ connection: "connecting", qr: null, qrDataUrl: null, lastError: null });
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
