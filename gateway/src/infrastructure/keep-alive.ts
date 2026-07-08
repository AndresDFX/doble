/**
 * Keep-alive: self-ping so a free-tier host never idles out.
 *
 * Render Free spins the service down after ~15 min WITHOUT INBOUND traffic,
 * killing the WhatsApp socket (inbound messages are lost until the next wake).
 * Outbound requests don't count — but a request to our OWN public URL arrives
 * as inbound, so a periodic self-ping keeps the service awake for as long as
 * the process lives. `/api/health` is outside Basic Auth on purpose.
 *
 * This covers the steady state; the GitHub Actions cron
 * (.github/workflows/keep-alive.yml) is the backup that wakes the service if
 * it ever does sleep (crash, suspend, deploy gap).
 */
import type { AppLogger } from "../domain/ports.js";

export function startKeepAlive(
  logger: AppLogger,
  opts: { url: string; intervalMs: number }
): () => void {
  const target = `${opts.url.replace(/\/+$/, "")}/api/health`;
  const ping = async () => {
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) logger.warn({ status: res.status, target }, "keep-alive ping non-OK");
    } catch (err) {
      logger.warn({ err, target }, "keep-alive ping failed");
    }
  };
  const timer = setInterval(() => void ping(), opts.intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ target, intervalMs: opts.intervalMs }, "Keep-alive self-ping started");
  return () => clearInterval(timer);
}
