# CLAUDE.md

Guía para Claude Code al trabajar en este repo. **MVP v1 de uso personal** — agente de WhatsApp con RAG. Plan completo en `C:\Users\Andre\.claude\plans\lo-primero-es-que-quiet-crystal.md`.

## Arquitectura

Dos procesos + Postgres, todos locales:

- `gateway/` (Node.js + TypeScript) — sesión WhatsApp vía Baileys, recepción/envío de mensajes, CLI de gestión. Habla HTTP al AI service.
- `ai/` (Python + FastAPI) — pipeline RAG con **Gemini free tier** (gemini-2.5-flash + gemini-embedding-001). Endpoints: `/health`, `/respond`, `/transcribe`, `/embed-and-store`, `/ingest-history`.
- `db/init.sql` — schema con pgvector. Se aplica auto al primer `docker compose up`.

El gateway nunca llama Gemini directamente — siempre vía el AI service. Esto aísla el SDK de Google a un solo proceso.

## Comandos habituales

Usuario está en **Windows PowerShell 5.1** — `&&` NO funciona, usar `;` o comandos separados.

```powershell
# DB
docker compose up -d postgres
docker compose logs -f postgres

# AI service (con venv ya creado y activado)
# Usamos run.py en vez de `uvicorn` directo: en Windows hay que setear
# WindowsSelectorEventLoopPolicy ANTES de que uvicorn cree su loop
# (ProactorEventLoop default no es compatible con psycopg async).
cd ai ; python run.py

# Gateway (otra terminal)
cd gateway ; npm run dev               # gateway normal
cd gateway ; npm run ingest-history    # bootstrap del RAG (NO al mismo tiempo que el gateway)
cd gateway ; npm run typecheck

# CLI de gestión
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
