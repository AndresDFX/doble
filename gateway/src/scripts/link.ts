/**
 * Link a WhatsApp session locally so a datacenter host (Render) can reuse it.
 *
 * WhatsApp usually rejects linking from a datacenter IP ("inténtalo más tarde").
 * The reliable path — same as the telegram-sender reference — is to link ONCE
 * from your residential IP into the SAME session store; Render then reuses it
 * (reconnecting an existing session is not blocked).
 *
 * This is a standalone tool: it only opens a Baileys socket and persists creds.
 * It needs NO Postgres and NO AI service — just the session-store env. It loads
 * `.env` and `.env.aws` (where your AWS creds live) automatically.
 *
 * Usage (from gateway/):
 *   npm run link                         # QR mode (uses WA_AUTH_STORE)
 *   npm run link -- --pair 573001234567  # pairing-code mode (8-digit code)
 *   npm run link -- --reset              # wipe the stored session, then exit
 *
 * For the Render flow set these first (in .env or .env.aws):
 *   WA_AUTH_STORE=dynamo  WA_AUTH_TABLE=...  AWS_REGION=...
 *   AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...
 */
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";

const __dirname = dirname(fileURLToPath(import.meta.url));
// gateway/src/scripts -> project root is three levels up.
const ROOT = resolve(__dirname, "../../..");
loadDotenv({ path: resolve(ROOT, ".env") });
loadDotenv({ path: resolve(ROOT, ".env.aws") }); // AWS creds for the dynamo store

// Linking touches neither Postgres nor the AI service. Satisfy config's required
// DATABASE_URL with a placeholder so importing it doesn't throw.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://unused";

// Imported AFTER the env is set (config reads it at module load).
const { config } = await import("../config.js");
const { getAuthState } = await import("../infrastructure/auth-state.js");

const argv = process.argv.slice(2);
const reset = argv.includes("--reset");
const pairIdx = argv.indexOf("--pair");
const pairNumber =
  pairIdx >= 0 ? (argv[pairIdx + 1] ?? "").replace(/[^0-9]/g, "") : "";

if (pairIdx >= 0 && !pairNumber) {
  console.error("✖ --pair requiere un número con código de país, solo dígitos. Ej: --pair 573001234567");
  process.exit(1);
}

function storeLabel(): string {
  return config.waAuthStore === "dynamo"
    ? `DynamoDB (tabla "${config.dynamoAuthTable}", región ${config.awsRegion}, sesión "${config.waSessionId}")`
    : `disco ("${config.waSessionDir}")`;
}

async function start(): Promise<void> {
  const { state, saveCreds, clearAll } = await getAuthState({
    sessionDir: config.waSessionDir,
    sessionId: config.waSessionId,
  });

  if (reset) {
    await clearAll();
    console.log(`🧹 Sesión borrada en ${storeLabel()}. Vuelve a correr sin --reset para vincular.`);
    process.exit(0);
  }

  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS("Desktop"), // más fiable para el linking
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  // Pairing-code mode: pide el código una vez que el socket arrancó y aún no está registrado.
  if (pairNumber && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairNumber);
        console.log(`\n🔑 Código de emparejamiento: ${code}`);
        console.log("   WhatsApp → Dispositivos vinculados → Vincular con número de teléfono.\n");
      } catch (err) {
        console.error("✖ No se pudo pedir el código de emparejamiento:", (err as Error).message);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr && !pairNumber) {
      console.log("\nEscanea este QR con WhatsApp → Dispositivos vinculados:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log(`\n✅ CONECTADO como ${sock.user?.id ?? "?"}.`);
      console.log(`   Sesión persistida en ${storeLabel()}.`);
      if (config.waAuthStore !== "dynamo") {
        console.log("   ⚠️  WA_AUTH_STORE no es 'dynamo': esto vinculó LOCAL, no para Render.");
      } else {
        console.log("   Render reutilizará esta sesión. Cierra esto (Ctrl-C); no dejes dos hosts conectados a la vez.");
      }
      setTimeout(() => process.exit(0), 1500); // deja que termine de guardar creds
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode ?? 0;
      if (code === DisconnectReason.loggedOut) {
        console.error("✖ Sesión inválida (loggedOut). Corre con --reset y reintenta.");
        process.exit(1);
      }
      console.log(`Conexión cerrada (code ${code}); reintentando…`);
      setTimeout(() => {
        start().catch((err) => {
          console.error("✖ Reconexión falló:", err);
          process.exit(1);
        });
      }, 1500);
    }
  });
}

console.log(`Vinculando WhatsApp · store: ${storeLabel()}${pairNumber ? ` · pairing-code para ${pairNumber}` : " · modo QR"}`);
start().catch((err) => {
  console.error("✖ Error al vincular:", err);
  process.exit(1);
});
