/**
 * batch-send: opens a SECONDARY Baileys session (WhatsApp A — your main
 * personal number) and sends a curated batch of messages to a target
 * WhatsApp (B — the agent's secondary number) so you can exercise the
 * agent against different topic profiles without typing each one.
 *
 * Usage:
 *   npm run batch-send -- --to 573XXXXXXXXX
 *   npm run batch-send -- --to 573XXXXXXXXX --themes familia,trabajo
 *   npm run batch-send -- --to 573XXXXXXXXX --themes propio --count 3
 *   npm run batch-send -- --to 573XXXXXXXXX --dry
 *
 * Flags:
 *   --to <number_or_jid>   required: phone number (will be normalised
 *                          to <digits>@s.whatsapp.net) or full JID
 *   --themes a,b,c         only send messages from these themes (default: all)
 *   --count N              cap per theme (default: all)
 *   --min-delay-ms N       minimum delay between sends, default 6000
 *   --max-delay-ms N       maximum delay between sends, default 15000
 *   --dry                  print plan, don't connect or send
 *   --messages-file <path> override default sender/messages.json
 *
 * Session directory: gateway/.wa-sender-session/ (isolated from the
 * main agent's session). First run shows a QR — scan from WhatsApp A.
 */

import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = resolve(__dirname, "../..");

type Args = {
  to: string;
  themes: string[] | null;
  count: number | null;
  minDelay: number;
  maxDelay: number;
  dry: boolean;
  messagesFile: string;
  sessionDir: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);

  const to = get("--to") ?? process.env.WA_TARGET ?? "";
  if (!to) {
    console.error("--to <number_or_jid> is required (or set WA_TARGET env var)");
    process.exit(2);
  }

  const themes = get("--themes")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
  const countStr = get("--count");
  const count = countStr ? Number(countStr) : null;
  const messagesFile = get("--messages-file") ?? resolve(GATEWAY_DIR, "sender/messages.json");
  const sessionDirArg = get("--session-dir") ?? ".wa-sender-session";

  return {
    to: normalizeJid(to),
    themes,
    count,
    minDelay: Number(get("--min-delay-ms") ?? 6000),
    maxDelay: Number(get("--max-delay-ms") ?? 15000),
    dry: has("--dry"),
    messagesFile: isAbsolute(messagesFile) ? messagesFile : resolve(GATEWAY_DIR, messagesFile),
    sessionDir: isAbsolute(sessionDirArg) ? sessionDirArg : resolve(GATEWAY_DIR, sessionDirArg),
  };
}

function normalizeJid(input: string): string {
  if (input.includes("@")) return input;
  const digits = input.replace(/\D/g, "");
  if (!digits) throw new Error(`Cannot normalize "${input}" to a JID`);
  return `${digits}@s.whatsapp.net`;
}

type Plan = { theme: string; text: string }[];

async function buildPlan(args: Args): Promise<Plan> {
  const raw = await readFile(args.messagesFile, "utf8");
  const catalog = JSON.parse(raw) as Record<string, string[]>;

  const themes = args.themes ?? Object.keys(catalog);
  const plan: Plan = [];
  for (const theme of themes) {
    const msgs = catalog[theme];
    if (!msgs?.length) {
      console.warn(`! theme "${theme}" has no messages in catalog — skipped`);
      continue;
    }
    const slice = args.count ? msgs.slice(0, args.count) : msgs;
    for (const text of slice) plan.push({ theme, text });
  }

  // Shuffle so themes interleave (less suspicious cadence than 7 family in a row)
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = plan[i]!;
    plan[i] = plan[j]!;
    plan[j] = tmp;
  }
  return plan;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(min: number, max: number): number {
  return min + Math.floor(Math.random() * Math.max(0, max - min));
}

async function connect(sessionDir: string): Promise<WASocket> {
  await mkdir(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  let sock: WASocket;
  let reconnecting = false;

  const makeSock = (): WASocket =>
    makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

  const opened = new Promise<WASocket>((resolveOpen, rejectOpen) => {
    const attach = (s: WASocket) => {
      s.ev.on("creds.update", saveCreds);
      s.ev.on("connection.update", (u) => {
        if (u.qr) {
          console.log("Scan this QR with WhatsApp A → Linked devices:");
          qrcode.generate(u.qr, { small: true });
        }
        if (u.connection === "open") {
          console.log(`✓ Connected as ${s.user?.id ?? "?"}`);
          resolveOpen(s);
        }
        if (u.connection === "close") {
          const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode ?? 0;
          if (code === DisconnectReason.restartRequired && !reconnecting) {
            reconnecting = true;
            console.log("Stream restart required (expected after pairing). Reconnecting…");
            setTimeout(() => {
              sock = makeSock();
              attach(sock);
              reconnecting = false;
            }, 1000);
          } else if (code === DisconnectReason.loggedOut || code === 401) {
            rejectOpen(
              new Error(
                `Session rejected (401). Delete ${sessionDir} and re-run to scan a fresh QR.`
              )
            );
          } else if (!reconnecting) {
            console.warn(`connection closed (code ${code}); ${u.lastDisconnect?.error?.message ?? ""}`);
          }
        }
      });
    };
    sock = makeSock();
    attach(sock);
  });

  return opened;
}

async function main() {
  const args = parseArgs();
  const plan = await buildPlan(args);

  console.log(`\nTarget: ${args.to}`);
  console.log(`Messages: ${plan.length} across ${new Set(plan.map((p) => p.theme)).size} themes`);
  console.log(`Cadence: ${args.minDelay}ms – ${args.maxDelay}ms between sends\n`);

  if (args.dry) {
    console.log("DRY RUN — plan only:");
    for (const item of plan) console.log(`  [${item.theme.padEnd(8)}] ${item.text}`);
    return;
  }

  const sock = await connect(args.sessionDir);

  // Brief settle period after connection
  await sleep(2000);

  let i = 0;
  for (const item of plan) {
    i++;
    try {
      await sock.sendMessage(args.to, { text: item.text });
      console.log(`[${i}/${plan.length}] ✓ [${item.theme}] ${item.text}`);
    } catch (err) {
      console.error(`[${i}/${plan.length}] ✗ [${item.theme}] failed:`, (err as Error).message);
    }
    if (i < plan.length) {
      const d = randomDelay(args.minDelay, args.maxDelay);
      await sleep(d);
    }
  }

  console.log("\nDone. Closing in 3s to let the last send flush…");
  await sleep(3000);
  await sock.end(undefined);
  process.exit(0);
}

main().catch((err) => {
  console.error("batch-send failed:", err);
  process.exit(1);
});
