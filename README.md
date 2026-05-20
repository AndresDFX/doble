# wa-agent (MVP v1)

Agente personal de WhatsApp con RAG. Lee tus chats existentes, aprende tu lenguaje y responde adaptando el tono según la etiqueta del chat (Familia / Trabajo / Amigos / Amor / custom).

> ⚠️ **MVP single-user, modo borrador por defecto.** El agente genera respuestas pero NO las envía automáticamente al chat hasta que desactives `draft_mode`. Plan completo en `C:\Users\Andre\.claude\plans\lo-primero-es-que-quiet-crystal.md`.

## Componentes

- `gateway/` — Node.js + Baileys + **Fastify HTTP API** (REST + SSE). Sesión de WhatsApp, recepción de mensajes, envío de respuestas, y endpoints `/api/*` que consume el frontend.
- `ai/` — Python + FastAPI. Embeddings, retrieval RAG (pgvector), generación con **Gemini 2.5 Flash**, transcripción multimodal con el mismo modelo (sin Whisper).
- `frontend/` — **React 19 + Vite + Tailwind v4 + TanStack Query**. Dashboard de administración: estado de servicios, gestión de chats/etiquetas, revisión de borradores, edición de prompts. Updates en tiempo real vía SSE.
- `db/init.sql` — schema de Postgres con extensión pgvector y datos iniciales.
- `docker-compose.yml` — stack completo: postgres + ai + gateway + frontend.

## Quick start con Docker (recomendado)

```powershell
Copy-Item .env.example .env
# editar .env y pegar tu GEMINI_API_KEY
docker compose up -d --build
```

Una vez todos los contenedores estén healthy:

- **Admin UI**: http://localhost:8081
- Gateway API: http://localhost:3000/api/health
- AI service: http://localhost:8000/health
- Postgres: localhost:5432 (user `wa_agent`, pass `wa_agent_dev`)

El emparejamiento de WhatsApp se hace **desde el dashboard**: la pestaña "Dashboard" muestra el QR cuando la conexión está en `connecting`. Apenas escaneas, la UI cambia a "open" en tiempo real.

> Comandos útiles:
> ```powershell
> docker compose logs -f gateway     # ver Baileys + API en vivo
> docker compose logs -f ai          # llamadas a Gemini + errores
> docker compose down                # bajar todo (preserva volúmenes)
> docker compose down -v             # bajar y borrar sesión WA + DB
> ```

## Setup local (sin Docker, dev/debug)

### 1. Requisitos
- Docker Desktop (solo para Postgres)
- Node.js 20+
- Python 3.11+
- Una **Gemini API key** gratuita ([aistudio.google.com](https://aistudio.google.com/apikey))

> Cuotas free tier de Gemini (aprox.): `gemini-2.5-flash` ~15 RPM / 1500 RPD,
> `gemini-embedding-001` ~100 RPM. Suficientes para uso personal; planea
> ingestión inicial de noche si tienes mucho historial.

### 2. Variables de entorno

PowerShell:
```powershell
Copy-Item .env.example .env
# editar .env y pegar tu GEMINI_API_KEY
```

bash / zsh:
```bash
cp .env.example .env
```

### 3. Postgres

```powershell
docker compose up -d postgres
docker compose ps                       # verificar que esté "running"
```

El schema (`db/init.sql`) se aplica automáticamente la primera vez.

### 4. AI service (Python)

**PowerShell** (un comando a la vez — PS 5.1 no soporta `&&`):
```powershell
cd ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
python run.py
```

> Si `Activate.ps1` falla con error de policy, una sola vez:
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

**bash / zsh**:
```bash
cd ai
python -m venv .venv
source .venv/bin/activate
pip install -e .
python run.py
```

Healthcheck: `curl http://localhost:8000/health`

### 5. Gateway (Node)

En otra terminal (PowerShell o bash):

```powershell
cd gateway
npm install
npm run dev
```

### 6. Frontend (Vite, opcional en dev local)

```powershell
cd frontend
npm install
npm run dev
```

El dev server queda en http://localhost:5173 con proxy a `http://localhost:3000` para `/api/*`. Si tu gateway no está en 3000, exporta `VITE_GATEWAY_URL=http://otra-host:puerto`.

Verás un código QR en la terminal. Escanéalo desde WhatsApp -> Dispositivos vinculados.

> **Recomendación**: usa un número secundario. Baileys es no-oficial y viola los ToS de WhatsApp; el riesgo de ban del número es real.

## Uso diario

### Estado del agente

```bash
cd gateway
npm run cli -- state                    # ver estado global
npm run cli -- enable                   # activar agente
npm run cli -- disable                  # desactivar agente
npm run cli -- draft off                # salir de draft mode (¡cuidado!)
npm run cli -- name "Julian"            # tu nombre para que se refiera a ti
```

### Por chat

```bash
npm run cli -- chat list                # ver todos los chats con etiqueta
npm run cli -- chat list familia        # filtrar por etiqueta
npm run cli -- chat disable <chat_jid>  # apagar agente solo para ese chat
npm run cli -- chat label <chat_jid> trabajo   # asignar etiqueta manualmente
```

### Borradores (cuando draft_mode = on)

```bash
npm run cli -- drafts                   # ver pendientes
npm run cli -- drafts approve <id>      # marcar aprobado (todavía no envía solo)
```

### Bootstrap del RAG con tu historial (PRIMERA VEZ)

**Antes** de arrancar el gateway por primera vez, corre el ingestor de historial. Esto usa `syncFullHistory: true` de Baileys para pedirle a WhatsApp todo el historial reciente que tiene del dispositivo, persistirlo y embedderlo.

```bash
# Importante: el gateway NO debe estar corriendo en paralelo
cd gateway
npm run ingest-history
```

- Te pedirá escanear QR (la primera vez).
- Se queda esperando a que WhatsApp termine de sincronizar el historial. Por defecto sale cuando ve `isLatest: true` o cuando lleva 60s sin actividad nueva. Variables: `HISTORY_IDLE_MS`, `HISTORY_MAX_MS`, `MAX_PER_CHAT`.
- Aplica automáticamente las **etiquetas nativas** (Familia / Trabajo / Amigos / Amor) que tengas en WhatsApp a cada chat.
- Embeddea todos los mensajes con texto.

Después de esto, ya puedes arrancar el gateway con `npm run dev`.

> Limitación: WhatsApp solo sirve el historial que el servidor tenga indexado para tu dispositivo (suele ser ~6 meses para chats activos, menos para inactivos). Para volúmenes grandes, considera correr ingestor varias veces con día de diferencia mientras WhatsApp pagina.

## Etiquetas

El sistema lee las **etiquetas nativas de WhatsApp** (Familia, Trabajo, Amigos, Amor) y las mapea a templates de prompt. Cada etiqueta tiene su propia `temperature` y plantilla de tono (ver `db/init.sql`).

Para personalizar el prompt de una etiqueta:

```sql
UPDATE labels_config
SET prompt_template = 'Eres {user_name}. ...',
    temperature = 0.7
WHERE label = 'trabajo';
```

## Verificación end-to-end

1. `docker compose up -d postgres` y verificar healthy
2. `uvicorn` corriendo y `curl localhost:8000/health` devuelve `{"status":"ok"}`
3. `npm run dev` en gateway, escanear QR
4. Desde otro número, mandarte un mensaje de texto al WhatsApp conectado
5. `npm run cli -- drafts` debería mostrar la respuesta generada como borrador
6. Mandarte un audio: debería transcribirse y generar borrador con el texto
7. Cambiar `chat label <jid> trabajo`, mandar mismo mensaje desde otro chat con etiqueta `familia`: verificar que las dos respuestas difieren en tono

## Estado v1 vs deferido

**En v1**: WhatsApp conectado, RAG por chat + por etiqueta, templates por categoría, transcripción de audios entrantes, on/off global y por chat, modo borrador.

**Diferido a v2+**: TTS / clonación de voz, stickers con visión, resúmenes diarios, alimentación de RAG por audio del dueño, notificaciones Telegram + aprobación humana, scheduler horario, multi-tenancy, Stripe, frontend web.

## Riesgos conocidos

1. **Ban de número**: usar número secundario. Cadencia humana (delay 2–8s + "typing") ya implementada en `outgoing.ts`.
2. **Privacidad**: todos los mensajes se envían a Google (Gemini) para embeddings/chat/STT. Self-hosting completo (ollama + whisper.cpp + nomic-embed-text) = trabajo de v2.
3. **Respuestas inadecuadas**: por eso `draft_mode = TRUE` por defecto. Bajar a `false` solo cuando confíes en la calidad.
4. **Cuotas Gemini free tier**: si te topas con `429 RESOURCE_EXHAUSTED`, esperar 60s y reintentar; o subir a tier de pago en aistudio.google.com.
