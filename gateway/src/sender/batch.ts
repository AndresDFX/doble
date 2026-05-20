import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import { bus } from "../events.js";
import { activity } from "../activity.js";
import { getSenderSock, senderIsOpen } from "./session.js";
import { readCatalog, type Catalog } from "./catalog.js";

export type BatchSpec = {
  to: string;
  themes: string[] | null;
  count: number | null;
  minDelayMs: number;
  maxDelayMs: number;
  dry?: boolean;
};

export type BatchState = {
  id: string | null;
  status: "idle" | "running" | "done" | "failed";
  total: number;
  sent: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
};

let current: BatchState = {
  id: null,
  status: "idle",
  total: 0,
  sent: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
};

let aborter: AbortController | null = null;

export function getBatchState(): BatchState {
  return current;
}

export function abortCurrentBatch(): boolean {
  if (current.status !== "running" || !aborter) return false;
  aborter.abort();
  return true;
}

function normalizeJid(input: string): string {
  if (input.includes("@")) return input;
  const digits = input.replace(/\D/g, "");
  if (!digits) throw new Error(`Cannot normalize "${input}" to a JID`);
  return `${digits}@s.whatsapp.net`;
}

function buildPlan(catalog: Catalog, spec: BatchSpec): { theme: string; text: string }[] {
  const themes = spec.themes && spec.themes.length > 0 ? spec.themes : Object.keys(catalog);
  const plan: { theme: string; text: string }[] = [];
  for (const theme of themes) {
    const msgs = catalog[theme];
    if (!msgs?.length) continue;
    const slice = spec.count ? msgs.slice(0, spec.count) : msgs;
    for (const text of slice) plan.push({ theme, text });
  }
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = plan[i]!;
    plan[i] = plan[j]!;
    plan[j] = tmp;
  }
  return plan;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, rejectSleep) => {
    const t = setTimeout(resolveSleep, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      rejectSleep(new Error("aborted"));
    }, { once: true });
  });
}

function randomDelay(min: number, max: number): number {
  return min + Math.floor(Math.random() * Math.max(0, max - min));
}

function publishState(): void {
  bus.publish({
    type: "batch-state",
    payload: {
      batchId: current.id,
      status: current.status,
      total: current.total,
      sent: current.sent,
      failed: current.failed,
    },
  });
}

export async function startBatch(spec: BatchSpec): Promise<BatchState> {
  if (current.status === "running") {
    throw new Error("Otro batch ya está en curso");
  }
  if (!senderIsOpen()) {
    throw new Error("Sender no está conectado");
  }

  const catalog = await readCatalog();
  const to = normalizeJid(spec.to);
  const plan = buildPlan(catalog, spec);

  if (plan.length === 0) {
    throw new Error("El plan está vacío (¿tema sin mensajes?)");
  }

  const batchId = randomUUID();
  current = {
    id: batchId,
    status: spec.dry ? "done" : "running",
    total: plan.length,
    sent: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: spec.dry ? new Date().toISOString() : null,
  };
  publishState();

  activity.push({
    kind: "batch",
    level: "info",
    message: `Batch ${batchId.slice(0, 8)} encolado: ${plan.length} mensajes${spec.dry ? " (DRY)" : ""}`,
    meta: { to, themes: spec.themes, count: spec.count },
  });

  if (spec.dry) {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i]!;
      bus.publish({
        type: "batch-progress",
        payload: {
          batchId,
          index: i + 1,
          total: plan.length,
          theme: p.theme,
          text: p.text,
          status: "sent",
        },
      });
    }
    activity.push({
      kind: "batch",
      level: "success",
      message: `Batch ${batchId.slice(0, 8)} terminó en modo DRY`,
    });
    return current;
  }

  aborter = new AbortController();
  const signal = aborter.signal;

  // Run async; HTTP returns immediately
  (async () => {
    const sock = getSenderSock();
    for (let i = 0; i < plan.length; i++) {
      if (signal.aborted) break;
      const p = plan[i]!;
      try {
        await sock.sendMessage(to, { text: p.text });
        current.sent++;
        bus.publish({
          type: "batch-progress",
          payload: {
            batchId,
            index: i + 1,
            total: plan.length,
            theme: p.theme,
            text: p.text,
            status: "sent",
          },
        });
        activity.push({
          kind: "batch",
          level: "info",
          message: `[${i + 1}/${plan.length}] ${p.theme}: ${p.text.slice(0, 60)}`,
          meta: { batchId, to },
        });
      } catch (err) {
        current.failed++;
        const errMsg = (err as Error).message;
        bus.publish({
          type: "batch-progress",
          payload: {
            batchId,
            index: i + 1,
            total: plan.length,
            theme: p.theme,
            text: p.text,
            status: "failed",
            error: errMsg,
          },
        });
        activity.push({
          kind: "batch",
          level: "error",
          message: `[${i + 1}/${plan.length}] FALLÓ ${p.theme}: ${errMsg}`,
          meta: { batchId, to },
        });
        logger.error({ err, p }, "Batch send failed");
      }
      publishState();
      if (i < plan.length - 1 && !signal.aborted) {
        try {
          await sleep(randomDelay(spec.minDelayMs, spec.maxDelayMs), signal);
        } catch {
          break;
        }
      }
    }

    current = {
      ...current,
      status: signal.aborted ? "failed" : "done",
      finishedAt: new Date().toISOString(),
    };
    publishState();
    activity.push({
      kind: "batch",
      level: signal.aborted ? "warn" : "success",
      message: signal.aborted
        ? `Batch ${batchId.slice(0, 8)} abortado tras ${current.sent} mensajes`
        : `Batch ${batchId.slice(0, 8)} terminó: ${current.sent} ok, ${current.failed} fallos`,
    });
    aborter = null;
  })();

  return current;
}
