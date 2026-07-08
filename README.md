# Doble (MVP v1)

**Tu doble en WhatsApp.** Agente personal con RAG: lee tus chats existentes, aprende tu lenguaje y **adapta el vocabulario a cada persona** (con base de español colombiano). Responde corto y natural según la etiqueta del chat (Familia / Trabajo / Amigos / Amor / custom), y **cuando le falta contexto no inventa**: se abstiene, te avisa y puede responder solo en cuanto le das la información.

> El nombre interno de la base de datos y sus credenciales siguen siendo `wa_agent` por compatibilidad con volúmenes existentes; sólo es plumbing, no afecta la marca.

> ⚠️ **MVP single-user, modo borrador por defecto.** El agente genera respuestas pero NO las envía automáticamente al chat hasta que desactives `draft_mode`.
>
> 📦 Repo: **github.com/AndresDFX/doble** · Guía de arquitectura y convenciones para contribuir: [CLAUDE.md](CLAUDE.md).

## Componentes

- `gateway/` — Node.js + Baileys + **Fastify HTTP API** (REST + SSE), estructurado con **Clean Architecture** (`domain` / `application` / `infrastructure`; ver [CLAUDE.md](CLAUDE.md)). Sesión de WhatsApp, recepción de mensajes, envío de respuestas, **scheduler de mensajes proactivos** (loop en segundo plano), y endpoints `/api/*` que consume el frontend.
- `ai/` — Python + FastAPI. Embeddings, retrieval RAG (pgvector), generación con **Gemini 2.5 Flash** (salida estructurada `{status, reply, missing}` para **abstenerse cuando falta contexto**), transcripción multimodal con el mismo modelo (sin Whisper).
- `frontend/` — **React 19 + Vite + Tailwind v4 + TanStack Query**. Dashboard de administración: estado de servicios, gestión de chats/etiquetas (con **edición de nombre** y **teléfono** por chat, y activación de **mensajes proactivos** con su rango por chat), revisión de borradores (incluidos los avisos de **falta de contexto**), edición de prompts. Updates en tiempo real vía SSE.
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

## Desplegar en la nube (Render free tier)

**Desplegado en producción:** https://doble.onrender.com (dashboard detrás de Basic Auth). Corre como **un solo web service** (gateway + AI + dashboard en un contenedor), con el mismo patrón que el proyecto hermano `telegram-sender`: la **sesión de WhatsApp vive en DynamoDB** (no en disco), así el disco efímero de Render deja de importar y no hay que re-escanear el QR en cada reinicio. El gateway sirve el dashboard en el mismo origen, detrás de **Basic Auth**.

- Blueprint listo: [`render.yaml`](render.yaml) + [`Dockerfile.render`](Dockerfile.render) (un solo servicio).
- Postgres+pgvector en **Supabase** (Session pooler, puerto 5432) o Neon — no en Render.
- Sesión en DynamoDB vía `WA_AUTH_STORE=dynamo` (ver [auth-state](gateway/src/infrastructure/auth-state.ts)).
- Vinculación de WhatsApp desde IP residencial con [`npm run link`](gateway/src/scripts/link.ts).

**Guía paso a paso:** [docs/DEPLOY-RENDER.md](docs/DEPLOY-RENDER.md) — tabla DynamoDB + IAM, base Neon, deploy de **un solo web service**, **vinculación desde IP residencial** con `npm run link` (Render bloquea el linking desde datacenter) y keep-alive para el sleep de Render Free.

> ¿Always-on de verdad y perpetuo? Una VM **Oracle Cloud Always Free** corre el `docker compose` completo sin el sleep de 15 min de Render. Render es el camino "igual que el otro proyecto"; Oracle es el más robusto para un agente *inbound*.

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
npm run cli -- chat proactive <chat_jid> on    # mensajes proactivos para ese chat
npm run cli -- chat proactive-range <chat_jid> 5 45   # silencio 5-45 min antes de reenganchar
```

### Borradores (cuando draft_mode = on)

```bash
npm run cli -- drafts                   # ver pendientes
npm run cli -- drafts approve <id>      # marcar aprobado (todavía no envía solo)
```

En el dashboard, la pestaña **Borradores** muestra dos tipos: respuestas normales listas para enviar/editar, y avisos de **falta de contexto** (`needs_info`) cuando el agente no supo responder — con el dato que necesita y un botón para responder tú. Ver [Cómo responde el agente](#cómo-responde-el-agente).

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

> **Auto-respuesta**: si había una pregunta pendiente por falta de contexto (un borrador `needs_info`), al guardar/editar la nota el agente **reevalúa lo pendiente y responde solo** si la nota ya resuelve la duda — sin esperar a que el contacto vuelva a insistir. La respuesta se entrega según `draft_mode` (borrador o envío). Ver [Cómo responde el agente](#cómo-responde-el-agente).

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

El sistema lee las **etiquetas nativas de WhatsApp** (Familia, Trabajo, Amigos, Amor) y las mapea a templates de prompt. Cada etiqueta tiene su propia `temperature`, una **plantilla de tono con límites por relación**, un **umbral de relevancia del RAG (`max_distance`)** y **ejemplos few-shot (`examples`)** — todo **editable desde la pestaña Etiquetas del dashboard** (sin tocar SQL), o directo en `db/init.sql` / `labels_config`. La `temperature` además se **ajusta dinámicamente** por mensaje: baja para preguntas factuales (más precisa), se mantiene para charla social (más natural).

Los **prompts base** canónicos por tipo de etiqueta viven en código ([gateway/src/domain/base-prompts.ts](gateway/src/domain/base-prompts.ts)): si dañas un prompt editándolo, el botón **"Base"** de la pestaña Etiquetas lo restaura al canónico (`POST /api/labels/:label/reset`). Esto también sirve para traer los prompts mejorados a una DB existente (el seed de `init.sql` no actualiza filas ya creadas).

Para personalizar el prompt de una etiqueta por SQL (alternativa a la UI):

```sql
UPDATE labels_config
SET prompt_template = 'Eres {user_name}. ...',
    temperature = 0.7
WHERE label = 'trabajo';
```

Además de las etiquetas de tono, existe una **etiqueta reservada `Owner`** para enrutar avisos (ver [Cómo responde el agente](#cómo-responde-el-agente)). No la renombres: el ruteo de notificaciones busca ese nombre literal.

## Cómo responde el agente

El motor de respuesta hace varias cosas para sonar humano y no meter la pata:

### Se adapta a cómo escribe cada persona
Además de imitar **tu** estilo, el agente espeja el **registro y vocabulario del contacto** en cada chat (acomodación lingüística): si el otro escribe formal, responde formal; si usa jerga, la usa. Por defecto se apoya en **español colombiano coloquial** (parce, qué más, bacano, de una…), pero **subordinado** a cómo escribe el contacto real — nunca fuerza jerga en alguien formal. Para esto, el retrieval suma un slice con los **mensajes recientes del contacto** (por tiempo, no por similitud), de modo que capta su forma actual de hablar.

### Responde corto
Imita el largo del contacto. Para saludos o confirmaciones devuelve cosas como "listo", "todo bien", "va" — sin preguntas retóricas de relleno ni explicaciones. Mejor corto que sonar a bot.

### No inventa nombres (pero sí identifica contactos)
Solo se dirige al contacto por su nombre si el chat tiene **nombre asignado**. Si no lo tiene, no usa ninguno; nunca inventa ni reutiliza nombres que aparezcan en los ejemplos de estilo o en el historial.

Ese nombre se **identifica automáticamente** desde WhatsApp (igual que en el proyecto de referencia): el gateway escucha los eventos de contactos (`contacts.upsert`/`update`, `messaging-history.set`) y el `pushName` de los mensajes, y rellena el nombre del chat. Precedencia, de mayor a menor: **manual** (lo que edites en la pestaña Chats) → **agenda** (nombre guardado en tu WhatsApp) → **pushName** (nombre auto-reportado del contacto). Una fuente nunca pisa a otra de mayor precedencia, así que tu edición manual siempre gana. Los nombres solo se aplican a **conversaciones existentes** (no llena la lista con toda tu agenda), y si hay pocos nombres el gateway re-sincroniza la libreta sin re-vincular.

La identificación también funciona **por número**: la búsqueda de la pestaña Chats (y las acciones masivas) matchean el **teléfono** además del nombre/id — puedes buscar `+57 300 123 4567` con espacios y `+` — y un nombre aprendido para un JID normal se **propaga a los chats que comparten el mismo número** (p. ej. el JID de privacidad `@lid` de la misma persona), siempre respetando la precedencia.

### Cuando no sabe, se abstiene (no alucina)
Si responder requiere un dato concreto que **no** está en el contexto ni en tus notas, el agente no inventa: el servicio `ai` devuelve `status = "need_info"` y, en vez de mandar algo inventado, se crea un **borrador "falta contexto"** en el dashboard indicando qué dato falta. El modelo decide entre `answer` y `need_info` vía salida estructurada `{status, reply, missing}`. Tampoco **mezcla contextos**: si tiene un dato de otro tema (otra hora, otro plan), no lo sustituye por la respuesta — se abstiene.

### No decide compromisos por ti
Si un mensaje te pide aceptar o confirmar algo que te **ata en el mundo real** (un plan, una cita, una hora/lugar de encuentro, un favor, un préstamo, una promesa), el agente **no decide por ti**: se abstiene y te avisa (igual que con la falta de contexto), para que **tú** confirmes. No responde "sí"/"de una"/"va" a un compromiso. La charla casual y la cortesía siguen fluyendo normal.

### Avisos por WhatsApp: etiqueta `Owner`
Marca con la etiqueta reservada **`Owner`** el chat que quieras (típicamente el tuyo). Cuando el agente se abstiene en **cualquier** chat, te llega un **aviso por WhatsApp** a ese chat con quién preguntó, qué decía y qué dato falta. Si ningún chat tiene la etiqueta, solo queda el borrador en el dashboard.

### Auto-respuesta al agregar contexto
Si había una pregunta pendiente por falta de contexto y luego agregas una **nota** (pestaña Notas) con esa información, el agente **reevalúa lo pendiente y responde solo** — sin esperar a que el contacto vuelva a insistir. La entrega respeta `draft_mode`: borrador si está activo, envío automático si lo apagaste.

> **`draft_mode` controla la entrega, no el comportamiento.** El agente siempre genera/reevalúa respuestas; `draft_mode = TRUE` las deja como borrador para que las revises, `FALSE` las envía solas. Esto aplica tanto a mensajes entrantes como a la auto-respuesta de arriba.

## Mensajes proactivos (el agente escribe primero)

Además de responder, Doble puede **escribir por iniciativa propia** en los chats que actives. Está pensado para sonar como un doble real: **no interrumpe conversaciones activas ni escribe al vacío** — tras un rato de silencio del contacto manda **un** reenganche natural y luego **espera**. Es **opt-in por chat** y está **apagado por defecto**.

- **Activación por chat**: en la pestaña **Chats**, junto al switch del agente, un switch **Proactivo** con dos campos de **rango en minutos** (mín–máx). Ese rango es el **silencio a esperar antes de reenganchar**: si el contacto lleva ese tiempo (aleatorio dentro del rango) sin escribir, Doble le manda un mensaje. (CLI: `chat proactive <jid> on|off`, `chat proactive-range <jid> <min> <max>`.)
- **Respeta el turno**: solo reengancha si **Doble habló de último**. Si el contacto escribió lo último, es turno de la respuesta normal (reactiva), no del proactivo.
- **Uno y espera (anti-spam)**: manda **un solo** reenganche sin respuesta; si el contacto no contesta, **no insiste**. El contador se reinicia cuando el contacto vuelve a escribir.
- **Toma el último contexto**: genera el mensaje desde los últimos mensajes del chat + tus **notas del dueño**, espejando el registro del contacto.
- **Reenganche ligero, sin comprometerte**: solo saluda o pregunta cómo va; **nunca** confirma planes/horas/citas ni inventa. Si el único tema abierto depende de una decisión tuya (p. ej. "¿salimos mañana?"), **se abstiene** — no responde "listo/de una" por ti.
- **Pausa por falta de contexto**: si Doble se abstuvo en un chat (borrador "falta contexto" pendiente), ese chat queda **en pausa** — no responde nada más (ni reactivo ni proactivo) hasta que lo resuelvas (respondes o agregas una nota).
- **Respeta `draft_mode`**: con `on` crea **borrador**; con `off` **envía** con cadencia humana (2–8s + "escribiendo").
- **Respeta los interruptores**: no dispara con el agente apagado (global o por chat), ni en el pseudo-chat de notas (`__owner__`).

Config (env del gateway, opcionales): `PROACTIVE_SCHEDULER` (`on`/`off`, default `on`) y `PROACTIVE_TICK_MS` (cada cuánto revisa el loop, default `30000`). El rango por chat se configura desde la UI/CLI (defaults 1–60 min en la DB).

> ⚠️ **Cuidado anti-baneo**: enviar mensajes no solicitados es más arriesgado que solo responder. Usa rangos amplios, actívalo en pocos chats y mantén `draft_mode = on` mientras calibras. (Pendiente para uso a escala: ventana horaria + cap diario de proactivos.)

## Verificación end-to-end

> 📋 **Plan de pruebas completo** (10 áreas, casos con pasos y resultado esperado, local y producción): [docs/TEST-PLAN.md](docs/TEST-PLAN.md). Lo de abajo es el smoke rápido.

1. `docker compose up -d postgres` y verificar healthy
2. `uvicorn` corriendo y `curl localhost:8000/health` devuelve `{"status":"ok"}`
3. `npm run dev` en gateway, escanear QR
4. Desde otro número, mandarte un mensaje de texto al WhatsApp conectado
5. `npm run cli -- drafts` debería mostrar la respuesta generada como borrador
6. Mandarte un audio: debería transcribirse y generar borrador con el texto
7. Cambiar `chat label <jid> trabajo`, mandar mismo mensaje desde otro chat con etiqueta `familia`: verificar que las dos respuestas difieren en tono
8. **Abstención**: preguntar algo factual sin contexto (p. ej. "¿a qué hora es la cita del viernes?"). Debe aparecer un borrador **"falta contexto"** (no una respuesta inventada). Un saludo, en cambio, sí se responde normal y corto.
9. **Auto-respuesta**: con un borrador `needs_info` pendiente, agregar en **Notas** el dato que falta. El agente debe convertirlo en respuesta (borrador o envío según `draft_mode`) sin que el contacto vuelva a preguntar.
10. **Avisos**: etiquetar un chat como `Owner`; al abstenerse en otro chat, debe llegar el aviso a ese chat por WhatsApp.
11. **Proactivo**: con `draft_mode = on`, activar **Proactivo** (rango `1`–`2` min) en un chat donde **Doble haya hablado de último** y el contacto lleve rato en silencio. Tras el silencio (ver pestaña **Actividad** o `docker compose logs -f gateway`): aparece **un** borrador proactivo y **no** un segundo (cap de 1). En un chat donde el **contacto** escribió de último, el proactivo **no** dispara (turno reactivo). En un chat con abstención pendiente, queda **en pausa** (no responde hasta resolver).

## Estado v1 vs deferido

**Hecho (v1+)**: WhatsApp conectado; RAG por chat + por etiqueta; templates de tono por categoría; transcripción de audios entrantes; on/off global y por chat; modo borrador; **dashboard web (React) con updates en vivo por SSE**; **notas del dueño por audio/texto que alimentan el RAG**; **inspector de RAG** (stats + explorador de retrieval); **feed de actividad en vivo**; **batch sender desde la UI** (cuenta A → agente B); **UI responsive (móvil/tablet)**; **gateway con Clean Architecture**; **publicado en GitHub**; **abstención anti-alucinación** (no inventa: borradores "falta contexto"); **no decide compromisos por el dueño** (planes/citas/préstamos → abstención + aviso); **avisos por WhatsApp** vía etiqueta reservada `Owner`; **auto-respuesta al agregar contexto** (reevalúa pendientes al guardar una nota); **adaptación de registro por chat** + base colombiana + respuestas cortas/humanas; **relevancia por etiqueta (`max_distance`) + few-shot (`examples`) tuneables desde la UI**; **temperatura dinámica** (factual→precisa, social→natural); **prompts de etiqueta con límites por relación**; **regla anti-invención de nombres**; **identificación automática de contactos** (nombre desde agenda/pushName, sin pisar lo manual); **edición de nombre y teléfono por chat** en el dashboard; **auto-revínculo de WhatsApp** (al desvincular purga la sesión y muestra QR nuevo solo) + botón "Revincular"; **mensajes proactivos turn-aware por chat** (reengancha tras el silencio del contacto, 1 mensaje y espera, solo si Doble habló de último, sin comprometerse; pausa el chat si se abstiene; respeta draft_mode); **desplegado en Render free tier** (https://doble.onrender.com — un solo web service, sesión Baileys en DynamoDB, Postgres en Supabase, Basic Auth).

**Diferido a v2+**: TTS / clonación de voz · stickers con visión · resúmenes diarios · notificaciones por Telegram (los avisos por WhatsApp + la revisión de borradores ya cubren la aprobación humana) · scheduler **horario/calendario** (ventanas de envío por hora del día; la cadencia aleatoria por chat ya está hecha) · multi-tenancy · Stripe · self-hosting (ollama + whisper.cpp + nomic-embed-text).

## Próximos pasos (tareas siguientes)

Cercano — sin romper las reglas de v1 (sin auth/Stripe/multi-tenancy):

1. **Tests del core**: el gateway ya tiene Clean Architecture, así que los casos de uso y las reglas son testeables sin DB/Baileys. Añadir unit tests de `application/process-incoming-message`, `domain/reply-policy` y los servicios usando *fakes* de los puertos (repos en memoria).
2. **CI en GitHub Actions**: typecheck + build de `gateway` y `frontend` en cada push (el repo ya está en GitHub).
3. **Rotar `GEMINI_API_KEY`**: la clave actual vivió en `.env` local; rotarla en aistudio.google.com por higiene (no se publicó — está en `.gitignore`).
4. **(Opcional) Extender Clean Architecture al servicio `ai/`** (Python): separar dominio (RAG/retrieval) de adapters (Gemini, pgvector).
5. **(Entorno) Fuente del terminal**: fijar *MesloLGM Nerd Font* para ver los íconos del prompt (Oh My Posh ya quedó activo en el perfil de PowerShell).
6. **Proactivo a escala — anti-baneo** (cuando se active proactivo en muchos chats): **quiet hours** (franja horaria configurable, p. ej. 8am–10pm en la zona del dueño; no reengancha de madrugada), **cap diario global** de proactivos (tope de mensajes/día sumando todos los chats) y, opcional, **espaciado** entre chats en el mismo tick. Es la traducción a Doble del "fraccionado con jitter" de un broadcaster (Doble no difunde a listas, así que NO se implementa eso). Enganche en `ProactiveMessenger` + un par de valores de config + un contador diario. Hoy no urge: el cap por chat (1 reenganche y espera) y la cadencia humana 2–8s ya cubren el uso normal.

Más adelante (v2): ver *Diferido a v2+*. La aprobación humana ya existe vía borradores + avisos por WhatsApp (etiqueta `Owner`); el siguiente salto natural sería notificaciones por Telegram o un scheduler horario.

## Riesgos conocidos

1. **Ban de número**: usar número secundario. Cadencia humana (delay 2–8s + "typing") ya implementada en `gateway/src/infrastructure/whatsapp-gateway.ts`.
2. **Privacidad**: todos los mensajes se envían a Google (Gemini) para embeddings/chat/STT. Self-hosting completo (ollama + whisper.cpp + nomic-embed-text) = trabajo de v2.
3. **Respuestas inadecuadas**: por eso `draft_mode = TRUE` por defecto. Bajar a `false` solo cuando confíes en la calidad. Mitigación adicional: el agente **se abstiene cuando le falta contexto** (no inventa) y respeta el nombre asignado al chat (no inventa nombres).
4. **Cuotas Gemini free tier**: si te topas con `429 RESOURCE_EXHAUSTED`, esperar 60s y reintentar; o subir a tier de pago en aistudio.google.com.
