# Plan de pruebas — Doble (MVP v1)

Guía para validar el agente de punta a punta, tanto **local** (docker compose) como en
**producción** (https://doble.onrender.com). Cada caso tiene precondición, pasos y
resultado esperado. Orden pensado para ejecutarse de arriba hacia abajo.

**Convenciones:** `A` = tu WhatsApp principal (envía pruebas) · `B` = el número
secundario del agente · *Dashboard* = UI admin (local `:8081` / prod la URL de Render,
con Basic Auth).

---

## 0. Precondiciones

| # | Chequeo | Cómo | Esperado |
|---|---------|------|----------|
| 0.1 | Servicios arriba | `GET /api/health` | `{gateway:ok, db:ok, ai:ok, wa:...}` |
| 0.2 | Schema al día | logs del gateway al arrancar | `auto-migrate: idempotent schema applied` |
| 0.3 | Basic Auth (solo prod) | abrir la URL sin credenciales | pide usuario/contraseña (401) |
| 0.4 | `draft_mode` ON | Dashboard → switch "Modo borrador" | activado (default; ninguna prueba envía sola) |

## 1. Conexión de WhatsApp (B)

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 1.1 | Vincular por QR | Dashboard → pestaña Dashboard → escanear QR con B (WhatsApp → Dispositivos vinculados) | La tarjeta pasa a "open" en vivo; `health.wa = open` |
| 1.2 | Sesión persiste | Reiniciar el servicio (Render: Manual Deploy → Restart / local: `docker compose restart gateway`) | Reconecta **sin** pedir QR (sesión en DynamoDB/volumen) |
| 1.3 | Re-vincular | Dashboard → botón de relink | Genera QR nuevo; al escanear vuelve a "open" |
| 1.4 | Un solo host | Con prod conectado, correr `npm run link` local | Uno de los dos pierde la sesión (error 440) — esperado; no dejar ambos |

## 2. Pipeline reactivo (responder mensajes)

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 2.1 | Texto simple | Desde A: "hola, qué más" a B | En *Actividad*: message-in + llamada a Gemini; en *Borradores*: borrador corto y natural ("bien y vos?" o similar) |
| 2.2 | Respuesta corta | Desde A: "listo?" | Borrador de 1-5 palabras, sin relleno ni preguntas retóricas |
| 2.3 | Audio | Desde A: nota de voz | Se transcribe (texto en *Actividad*) y genera borrador sobre el contenido |
| 2.4 | Enviar borrador | *Borradores* → editar (opcional) → Enviar | Llega a A con cadencia humana (2-8s + "escribiendo…"); borrador pasa a `sent` |
| 2.5 | Descartar borrador | *Borradores* → descartar | Desaparece de pendientes; no se envía nada |
| 2.6 | Agente OFF global | Dashboard → apagar agente; A escribe | Mensaje se guarda (visible en Chats) pero NO se genera borrador |
| 2.7 | Agente OFF por chat | Chats → switch del chat de A en off; A escribe | Igual que 2.6 pero solo ese chat |

## 3. Etiquetas y prompts (módulo de prompts base)

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 3.1 | Tono por etiqueta | Etiquetar chat de A como `trabajo`; A: "quedamos mañana?" → luego cambiar a `amigos` y repetir | Borradores con tono distinto: trabajo = sobrio ("déjame confirmo y te aviso"); amigos = relajado |
| 3.2 | Editar prompt | *Etiquetas* → editar template de `trabajo` (p. ej. "responde siempre de usted") → Guardar → repetir 3.1 | El borrador refleja la edición |
| 3.3 | **Restaurar base** | *Etiquetas* → botón "Base" en `trabajo` → confirmar | El template vuelve al canónico (con LÍMITES y ejemplos); el editor muestra los valores base |
| 3.4 | Base solo en etiquetas estándar | Crear etiqueta custom `clientes` | No muestra botón "Base" (no tiene base canónico) |
| 3.5 | Prompt general | *Etiquetas* → card "Prompt general": "termina siempre con 👍" → Guardar → A escribe | El borrador obedece la instrucción global en cualquier etiqueta (quitarla después) |
| 3.6 | Ejemplos few-shot | Añadir ejemplos a una etiqueta y probar | El tono/largo de los borradores se acerca a los ejemplos |

## 4. Abstención y avisos (anti-alucinación)

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 4.1 | need_info | A: "¿a qué hora es la cita del viernes?" (dato que no existe) | NO inventa: aparece borrador **"falta contexto"** con el dato faltante |
| 4.2 | Aviso al Owner | Etiquetar tu chat propio como `Owner`; repetir 4.1 desde otro chat | Llega aviso por WhatsApp al chat Owner (quién, qué dijo, qué falta) |
| 4.3 | Auto-respuesta con nota | Con el needs_info de 4.1 pendiente: *Notas* → escribir "la cita del viernes es a las 3pm" → Guardar | El agente reevalúa y genera la respuesta (borrador) SIN que A insista |
| 4.4 | Notas por audio | *Notas* → Grabar un dato personal → revisar transcripción → Guardar | Nota transcrita y embebida; influye en respuestas futuras (background) |

## 5. Identificación de contactos

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 5.1 | Nombre desde agenda | Que escriba alguien que tienes en la agenda de B | En *Chats* su nombre aparece solo (`name_source=contact`); *Actividad*: "Identificados N contacto(s)" |
| 5.2 | Nombre desde pushName | Que escriba alguien que NO está en la agenda | Aparece su pushName (`name_source=push`) |
| 5.3 | Manual gana | Editar el nombre a mano en *Chats* → que vuelva a escribir | El nombre manual NO se pisa |
| 5.4 | **Búsqueda por número** | *Chats* → buscar "+57 300 123 4567" (con espacios/+) | Encuentra el chat aunque el nombre no coincida (matchea la columna phone) |
| 5.5 | **Propagación por número** | Contacto con chat `@lid` y `@s.whatsapp.net` (mismo teléfono) | Al identificarse el nombre en uno, el otro chat hereda el nombre |
| 5.6 | El agente usa el nombre | Chat con nombre asignado: A saluda | El borrador puede dirigirse por ese nombre; en chat SIN nombre, jamás usa nombre alguno |
| 5.7 | Cuenta de sincronización | Tras actividad en un chat, ver `chats.wa_account` (o el badge) | Guarda los dígitos del número B conectado; si se re-vincula con OTRO número, los chats viejos muestran badge "otra cuenta" y conservan su `wa_account` original |

## 6. Acciones masivas y listas (selección + exclusión)

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 6.1 | Desactivar por etiqueta | *Chats* → filtrar `familia` → "Desactivar agente" → confirmar | Toast "Agente desactivado en N chat(s)"; solo esos chats quedan off |
| 6.2 | Activar por búsqueda | Buscar por texto o número → "Activar agente" | Solo los que coinciden con el filtro cambian |
| 6.3 | Owner intocable | Bulk sin filtro / por ids incluyendo `__owner__` | El pseudo-chat `__owner__` nunca cambia |
| 6.4 | Marcados (checkboxes) | Marcar 2-3 chats sueltos → "Excluir marcados" → luego "Incluir marcados" | Solo los marcados cambian; el contador de marcados se resetea tras la acción |
| 6.5 | Marcar todos los visibles | Filtrar por etiqueta → checkbox "Marcar todos" → excluir | Marca/afecta solo los chats visibles del filtro |
| 6.6 | Auto-excluir por patrón | Card "⛔ Auto-excluir": escribir `FAM` → Guardar patrones | Toast con N auto-excluidos; todo chat cuyo nombre contenga "fam" (cualquier caso) queda off |
| 6.7 | Patrón aplica a nombres nuevos | Con patrón `FAM` guardado, que escriba un contacto nuevo cuya agenda diga "Tía FAMILIA" | Al identificarse el nombre, el chat queda auto-excluido (Actividad: "Auto-excluidos N chat(s)") |
| 6.8 | Exclusión es de una vía | Quitar el patrón y guardar | Los chats excluidos NO se re-activan solos (usar switch/checkboxes para incluir) |

## 7. Proactivo (turn-aware)

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 7.1 | Opt-in | *Chats* → activar proactivo en el chat de A con rango corto (1-2 min) | Se programa `proactive_next_ts` |
| 7.2 | Reenganche tras silencio | Que el ÚLTIMO mensaje del chat sea del agente (B); esperar el rango | Aparece borrador proactivo de reenganche, sin inventar planes |
| 7.3 | Turno del contacto | Si el último mensaje es de A (sin responder) | NO hay proactivo (el turno es del agente vía pipeline normal, no nudge) |
| 7.4 | Cap de no-respuesta | Tras 1 nudge sin respuesta de A | NO manda un segundo nudge (NUDGE_CAP=1) hasta que A escriba |
| 7.5 | Pausa por needs_info | Con un needs_info pendiente en ese chat | NO hay proactivo ni respuestas hasta resolverlo |
| 7.6 | Reset al recibir | A responde cualquier cosa | `proactive_unanswered` vuelve a 0 y se reprograma el ciclo |

## 8. RAG e inspección

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 8.1 | Stats | *RAG* → stats globales | Embeddings > 0 si hubo ingesta/mensajes; cobertura razonable |
| 8.2 | Explorador | Query hipotética contra el chat de A | Devuelve mensajes relevantes con similitud %; explica "por qué respondió así" |
| 8.3 | Contexto real | Preguntar algo que SÍ está en el historial | El borrador usa ese contexto (sin need_info) |

## 9. Batch sender (matriz de prueba)

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 9.1 | Conectar A | *Batch* → Conectar → escanear QR con A | Sender "open"; el explicador de la pestaña aclara por qué A ≠ B |
| 9.1b | Sesión A persiste | Reiniciar el servicio y volver a *Batch* | El sender reconecta SIN pedir QR (sesión `sender::` en DynamoDB / `.wa-sender-session` local) |
| 9.2 | Vista previa | Elegir temas + "Vista previa" | Muestra el plan sin enviar |
| 9.3 | Lote real | 2-3 mensajes, delays por defecto, destino B | Progreso en vivo; B los recibe; el agente genera borradores para cada uno |

## 10. Específicos de producción (Render)

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 10.1 | Auto-migrate | Tras cada deploy: logs | `auto-migrate: idempotent schema applied`, sin errores de columnas |
| 10.2 | Keep-alive (self-ping) | No tocar el servicio por >20 min y pedir `/api/health` | Responde en <3s (no hubo cold start): el self-ping lo mantuvo despierto; en logs, "Keep-alive self-ping started" al arrancar |
| 10.2b | Keep-alive (respaldo) | GitHub → Actions → workflow `keep-alive` → Run workflow | El job termina verde (HTTP 200); si el servicio dormía, lo despierta |
| 10.3 | Sobrevivir restart | Manual Deploy → Restart | Reconecta sin QR (sesión DynamoDB); mensajes durante el gap se procesan al volver (persist-only, sin responder viejos) |
| 10.4 | Cold start | Si duerme: primer request | Tarda ~10-60s y responde; después fluido |
| 10.5 | Memoria | Render → Metrics tras 24h | Sin OOM (Node+Python en 512MB van justos pero caben) |

---

## Registro de resultados

Copia esta tabla por sesión de pruebas:

| Fecha | Caso | ✅/❌ | Notas |
|-------|------|------|-------|
|       |      |      |       |

> Bugs conocidos que NO son fallos: primer healthcheck del AI al arrancar puede
> loguear `ECONNREFUSED` (carrera benigna de ~20ms, se auto-recupera). Cuotas Gemini
> free tier: `429 RESOURCE_EXHAUSTED` → esperar 60s y reintentar.
