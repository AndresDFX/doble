# CLAUDE.md

Guía para Claude Code al trabajar en este repo. **MVP v1 de uso personal** — agente de WhatsApp con RAG. Plan completo en `C:\Users\Andre\.claude\plans\lo-primero-es-que-quiet-crystal.md`.

## Arquitectura

Cuatro servicios, dockerizables, comunicados por red interna de compose:

- `gateway/` (Node.js + TypeScript + **Fastify**) — sesión WhatsApp vía Baileys, pipeline de mensajes, y **HTTP API en `/api/*` + SSE en `/api/events`** que sirve al frontend. CLI heredado sigue funcionando.
- `ai/` (Python + FastAPI) — pipeline RAG con **Gemini free tier** (gemini-2.5-flash + gemini-embedding-001). Endpoints internos: `/health`, `/respond`, `/transcribe`, `/embed-and-store`, `/ingest-history`. Solo el gateway lo llama.
- `frontend/` (React 19 + Vite + Tailwind v4 + TanStack Query) — dashboard admin. En Docker se sirve por nginx en puerto 8081 con proxy a `/api/`. En dev local, `npm run dev` en puerto 5173.
- `db/init.sql` — schema con pgvector. Se aplica auto al primer `docker compose up`.

El gateway nunca llama Gemini directamente — siempre vía el AI service. Esto aísla el SDK de Google a un solo proceso.

Event bus en el gateway (`src/events.ts`) y mirror de estado WA (`src/wa-status.ts`) son los puentes entre Baileys y la SSE: los handlers de Baileys publican; la ruta SSE consume y emite al frontend.

## Comandos habituales

Usuario está en **Windows PowerShell 5.1** — `&&` NO funciona, usar `;` o comandos separados.

### Stack completo via Docker (modo "normal")

```powershell
docker compose up -d --build       # arranca postgres + ai + gateway + frontend
docker compose logs -f gateway     # logs del gateway en vivo
docker compose down                # bajar todo (mantiene volúmenes)
```

Admin UI en http://localhost:8081. Reemparejar WhatsApp se hace ahí (no en terminal).

### Dev local (solo cuando se está iterando código)

```powershell
docker compose up -d postgres      # solo la DB
cd ai ; python run.py              # AI service en :8000 (venv activado)
cd gateway ; npm run dev           # gateway en :3000 con tsx watch
cd frontend ; npm run dev          # frontend en :5173 con HMR

# Bootstrap RAG (one-shot, NO al mismo tiempo que el gateway)
cd gateway ; npm run ingest-history

# CLI heredado (la UI hace casi todo esto ahora, pero el CLI sigue util)
cd gateway ; npm run cli -- state
cd gateway ; npm run cli -- draft on
cd gateway ; npm run cli -- chat label <jid> trabajo
cd gateway ; npm run cli -- drafts
```

Activación de venv en PowerShell: `.\.venv\Scripts\Activate.ps1` (NO `activate` a secas).

## Convenciones del código

- **Gateway en TS** con `"type": "module"` y `moduleResolution: Bundler` — usa imports `.js` aunque el archivo sea `.ts`.
- **AI en Python 3.11+** con async/await en todas las rutas; el cliente Gemini usa `client.aio.models.*`.
- **Postgres**: una sola DB para todo (chats, messages, embeddings, drafts, agent_state). No introducir vector DB aparte.
- **Embeddings**: dimensión fija 1536, normalización L2 obligatoria (gemini-embedding-001 lo requiere al truncar desde 3072).
- **Etiquetas WhatsApp** se leen automáticamente vía `labels.edit` + `labels.association.update`. Mapping de nombres normalizado en `gateway/src/scripts/init-history.ts` (familia/family → familia, etc).
- **Prompts por etiqueta** viven en la tabla `labels_config` (no hardcodeados). Modificar SQL, no código, para tunear tono o `temperature`.

## Reglas críticas (no romper)

1. **`draft_mode = TRUE` por defecto.** El agente NO debe enviar respuestas automáticamente hasta que el usuario lo apague explícitamente con `cli draft off`. Nunca cambiar el default en el schema.
2. **Cadencia humana al enviar**: `gateway/src/handlers/outgoing.ts` aplica delay aleatorio 2-8s + presence "composing". No quitar — protege contra ban de Baileys.
3. **Nunca ejecutar el gateway y `init-history` al mismo tiempo** — comparten sesión de WhatsApp Web y se patean.
4. **Single-user en v1.** Sin auth, sin Stripe, sin multi-tenancy. Estos están explícitamente diferidos a v2; el usuario rechaza re-introducirlos en v1.

## Lo que NO está en v1 (diferido a v2, no proponer sin pedir)

TTS / clonación de voz · stickers con visión · resúmenes diarios · alimentación de RAG por audio del dueño · notificaciones Telegram para aprobación humana · scheduler horario · multi-tenancy · Stripe · frontend web.

## Riesgos a recordar

- **Baileys viola ToS de WhatsApp**: el usuario usa número secundario, asume riesgo de ban.
- **Cuotas Gemini free tier**: ~15 RPM para chat, ~100 RPM para embeddings. En bootstrap masivo puede haber `429 RESOURCE_EXHAUSTED` — reintentar tras 60s, no añadir backoff complejo en v1.
- **Privacidad**: todo el contenido de chats va a Google. Self-hosting (ollama + whisper.cpp) es trabajo de v2.

## Archivos por dónde empezar

- Pipeline de respuesta entrante: [gateway/src/handlers/incoming.ts](gateway/src/handlers/incoming.ts)
- Generación con Gemini: [ai/app/routers/respond.py](ai/app/routers/respond.py)
- Retrieval dual (chat + label): [ai/app/rag/retrieval.py](ai/app/rag/retrieval.py)
- Construcción del prompt: [ai/app/prompts/builder.py](ai/app/prompts/builder.py)
- Schema: [db/init.sql](db/init.sql)
- HTTP API del admin: [gateway/src/api/server.ts](gateway/src/api/server.ts) + [gateway/src/api/routes/](gateway/src/api/routes/)
- Event bus (publica WA/mensajes/drafts): [gateway/src/events.ts](gateway/src/events.ts)
- SSE para el frontend: [gateway/src/api/routes/events.ts](gateway/src/api/routes/events.ts)
- Cliente API tipado del frontend: [frontend/src/lib/api.ts](frontend/src/lib/api.ts)
- Wiring de SSE → React Query: [frontend/src/lib/useSSE.ts](frontend/src/lib/useSSE.ts) y [frontend/src/App.tsx](frontend/src/App.tsx)
- Vistas: [frontend/src/views/](frontend/src/views/)
- Compose stack: [docker-compose.yml](docker-compose.yml)
- Dockerfiles: [gateway/Dockerfile](gateway/Dockerfile), [ai/Dockerfile](ai/Dockerfile), [frontend/Dockerfile](frontend/Dockerfile) + [frontend/nginx.conf](frontend/nginx.conf)
