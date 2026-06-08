# Doble (MVP v1)

**Tu doble en WhatsApp.** Agente personal con RAG: lee tus chats existentes, aprende tu lenguaje y responde adaptando el tono según la etiqueta del chat (Familia / Trabajo / Amigos / Amor / custom).

> El nombre interno de la base de datos y sus credenciales siguen siendo `wa_agent` por compatibilidad con volúmenes existentes; sólo es plumbing, no afecta la marca.

> ⚠️ **MVP single-user, modo borrador por defecto.** El agente genera respuestas pero NO las envía automáticamente al chat hasta que desactives `draft_mode`.
>
> 📦 Repo: **github.com/AndresDFX/doble** · Guía de arquitectura y convenciones para contribuir: [CLAUDE.md](CLAUDE.md).

## Componentes

- `gateway/` — Node.js + Baileys + **Fastify HTTP API** (REST + SSE), estructurado con **Clean Architecture** (`domain` / `application` / `infrastructure`; ver [CLAUDE.md](CLAUDE.md)). Sesión de WhatsApp, recepción de mensajes, envío de respuestas, y endpoints `/api/*` que consume el frontend.
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

## Probar el agente con mensajes en lote (Batch desde el frontend)

Para no tener que escribir mensajes uno a uno desde WhatsApp A hacia el agente en B, abre el dashboard y entra a la pestaña **Batch**:

1. **Sender card** (izquierda): da click en *Conectar* → aparece un QR. Escanéalo con tu **WhatsApp principal (A)**. La sesión queda persistida en el volumen `wa_session` del contenedor (o en `gateway/.wa-sender-session/` en dev local).
2. **Disparar lote** (centro): escribe el JID o número del WhatsApp destino (B), marca los temas que quieras (familia / trabajo / amigos / amor / propio / salud / reunion), opcionalmente fija un máximo por tema y los delays mínimo/máximo entre mensajes. Activa "Vista previa" para ver el plan sin enviar.
3. **Progreso** (panel inferior): barra en vivo, contador enviados/fallidos, botón para abortar. El detalle por mensaje sale en la pestaña **Actividad** con el filtro `Batch`.

El catálogo de mensajes vive en [gateway/sender/messages.json](gateway/sender/messages.json) — agrupado por tema con 5-7 mensajes cada uno. Los temas `salud` y `reunion` están pensados para probar las features de v2 (notificaciones Telegram para aprobación humana).

> Sigue existiendo el CLI `npm run batch-send -- --to <num>` para uso headless, pero la UI ahora es el camino principal y maneja mejor la cadena pairing/abort/reintento.

> **Cuidado**: el sender manda desde tu **WhatsApp principal** (A), no desde el secundario. Aunque Baileys imita cadencia humana, no abuses — 30 mensajes en una hora a una sola persona es plausible; 200 en 10 minutos hará que WhatsApp marque tu número.

## Alimentar el RAG con notas del dueño (audios o texto)

Pestaña **Notas**: graba audio directamente en el navegador (botón Grabar usa `MediaRecorder`) o sube un archivo (`.ogg`/`.opus`/`.webm`/`.m4a`/`.mp3`/`.wav`). El audio se sube al gateway, se transcribe con Gemini multimodal y aparece en un textarea editable. Revisas, corriges si hace falta y das *Guardar*.

Cuando guardas:
1. El texto se persiste como un message row con `chat_id = '__owner__'` y `from_me = TRUE`.
2. Se embedde en pgvector con `label = '__owner__'`.
3. Retrieval lo pulla automáticamente como contexto de fondo en **todas** las respuestas (top-4 por defecto, configurable via `k_owner`).

En el prompt, las notas del dueño aparecen en una sección dedicada `--- Información personal del dueño (background) ---` con instrucción de tratarlas como contexto factual, NO como ejemplos de estilo. Así sirven como memoria personal sin contaminar el tono.

Ideas de cosas para grabar:
- Hechos sobre tu vida que el agente debe saber ("mi pareja se llama X", "trabajo en Y como Z", "soy alérgico a A")
- Preferencias de tono ("nunca uso emojis con mi jefa", "siempre cierro con 'gracias!'")
- Contexto temporal ("este mes estoy de viaje hasta el 25")

Cuando un dato cambie, edita o borra la nota — se re-embedde al editar.

## Inspeccionar el RAG

La pestaña **RAG** muestra qué está pasando en la capa de embeddings + retrieval:

- **Stats globales**: total de embeddings, cobertura (cuántos mensajes con contenido están embedded), número de etiquetas con material.
- **Por etiqueta**: barras horizontales con embeddings + chats por cada etiqueta. Útil para ver si una etiqueta está sub-representada.
- **Top chats**: tabla de los 25 chats con más embeddings (los que más material aportan al RAG).
- **Explorador**: escribe una query hipotética, selecciona un chat (y/o override de etiqueta), ajusta `k_chat` / `k_label`, y mira qué mensajes recuperaría el agente. Cada match muestra contenido, badge de quién lo escribió, distancia coseno y similitud %. No quema una llamada a Gemini de chat — solo embedding del query.

Esto es lo que destraba "¿por qué el agente está respondiendo así?" — puedes replicar el contexto que vio para cualquier draft.

## Ver actividad en vivo

La pestaña **Actividad** muestra todo lo que pasa en el gateway en tiempo real:

- Mensajes entrantes / salientes
- Llamadas a Gemini con latencia
- Borradores creados
- Conexiones de WhatsApp / Sender (incluyendo errores de pairing)
- Progreso de cada batch mensaje por mensaje

Filtra por categoría con los chips superiores o busca por texto libre. Los eventos llegan vía SSE (sin polling) y se guardan en un ring buffer de las últimas 500 entradas en memoria.

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

**Hecho (v1+)**: WhatsApp conectado; RAG por chat + por etiqueta; templates de tono por categoría; transcripción de audios entrantes; on/off global y por chat; modo borrador; **dashboard web (React) con updates en vivo por SSE**; **notas del dueño por audio/texto que alimentan el RAG**; **inspector de RAG** (stats + explorador de retrieval); **feed de actividad en vivo**; **batch sender desde la UI** (cuenta A → agente B); **UI responsive (móvil/tablet)**; **gateway con Clean Architecture**; **publicado en GitHub**.

**Diferido a v2+**: TTS / clonación de voz · stickers con visión · resúmenes diarios · notificaciones Telegram + aprobación humana · scheduler horario · multi-tenancy · Stripe · self-hosting (ollama + whisper.cpp + nomic-embed-text).

## Próximos pasos (tareas siguientes)

Cercano — sin romper las reglas de v1 (sin auth/Stripe/multi-tenancy):

1. **Tests del core**: el gateway ya tiene Clean Architecture, así que los casos de uso y las reglas son testeables sin DB/Baileys. Añadir unit tests de `application/process-incoming-message`, `domain/reply-policy` y los servicios usando *fakes* de los puertos (repos en memoria).
2. **CI en GitHub Actions**: typecheck + build de `gateway` y `frontend` en cada push (el repo ya está en GitHub).
3. **Rotar `GEMINI_API_KEY`**: la clave actual vivió en `.env` local; rotarla en aistudio.google.com por higiene (no se publicó — está en `.gitignore`).
4. **(Opcional) Extender Clean Architecture al servicio `ai/`** (Python): separar dominio (RAG/retrieval) de adapters (Gemini, pgvector).
5. **(Entorno) Fuente del terminal**: fijar *MesloLGM Nerd Font* para ver los íconos del prompt (Oh My Posh ya quedó activo en el perfil de PowerShell).

Más adelante (v2): ver *Diferido a v2+*. Buen primer candidato: notificaciones Telegram + aprobación humana — el catálogo de batch ya trae temas `salud`/`reunion` pensados para probarlas.

## Riesgos conocidos

1. **Ban de número**: usar número secundario. Cadencia humana (delay 2–8s + "typing") ya implementada en `gateway/src/infrastructure/whatsapp-gateway.ts`.
2. **Privacidad**: todos los mensajes se envían a Google (Gemini) para embeddings/chat/STT. Self-hosting completo (ollama + whisper.cpp + nomic-embed-text) = trabajo de v2.
3. **Respuestas inadecuadas**: por eso `draft_mode = TRUE` por defecto. Bajar a `false` solo cuando confíes en la calidad.
4. **Cuotas Gemini free tier**: si te topas con `429 RESOURCE_EXHAUSTED`, esperar 60s y reintentar; o subir a tier de pago en aistudio.google.com.
