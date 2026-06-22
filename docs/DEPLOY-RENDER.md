# Desplegar Doble en Render (free tier)

> ✅ **Desplegado:** https://doble.onrender.com — `db:ok`, `ai:ok` con Supabase. Falta
> solo vincular WhatsApp (§4) para que `wa` pase de `connecting` a `open`.

**Un solo web service** corre todo el stack (gateway + AI + dashboard) en un
contenedor. La **sesión de WhatsApp vive en DynamoDB**, no en disco — así el disco
efímero de Render deja de importar (reinicios/spin-down **no** exigen re-escanear
el QR). El dashboard va detrás de **Basic Auth** porque no tiene login propio.

> **Postgres+pgvector NO va en Render** (su Postgres free expira). Usa **Neon** o
> **Supabase** (ambos free, ambos traen pgvector). Es el único recurso externo
> además de la tabla DynamoDB.

## Topología

```
Navegador ──Basic Auth──► doble (1 web service · Render · Docker)
                            ├─ gateway (Node): Baileys always-on + API + dashboard
                            │     • sesión ──────────────► DynamoDB
                            │     • llama (localhost:8000) ─┐
                            ├─ AI (Python): RAG + Gemini  ◄─┘ ── Gemini
                            └─ ambos ───────────────────► Neon/Supabase (pgvector)
```

El gateway sirve el SPA y la API en `$PORT` (lo que Render expone); el AI corre en
`127.0.0.1:8000` dentro del mismo contenedor (no se expone). Todo se define en
[`render.yaml`](../render.yaml) (Blueprint) + [`Dockerfile.render`](../Dockerfile.render).

---

## 1. Tabla DynamoDB para la sesión

Partition key **`id`** (String), billing on-demand. Con AWS CLI:

```bash
aws dynamodb create-table \
  --table-name doble-whatsapp-auth \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Crea un IAM user (programmatic) con esta policy de mínimo privilegio (ajusta la
región/cuenta en el ARN):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Scan"],
    "Resource": "arn:aws:dynamodb:us-east-1:*:table/doble-whatsapp-auth"
  }]
}
```

Guarda su `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. La tabla cabe de sobra en
el free tier perpetuo de DynamoDB (25 GB, items diminutos).

## 2. Postgres + pgvector (Supabase o Neon)

### Supabase (recomendado, agent-friendly)

Al **crear el proyecto**: nombre `doble`, password fuerte (guárdalo), región US (la
misma que elijas para Render). En *Security* puedes **desactivar Data API,
auto-expose y automatic RLS** — Doble se conecta directo a Postgres, no usa la API
REST. **No** conectes el repo de GitHub: el schema es un solo `db/init.sql`, no un
flujo de migraciones (lo aplicas en un paso abajo).

1. **Habilita pgvector:** Dashboard → *Database → Extensions* → activa **`vector`**
   (o deja que el paso 2 lo cree).
2. **Aplica el schema:** *SQL Editor* → pega [`db/init.sql`](../db/init.sql) → Run.
   Incluye `CREATE EXTENSION vector`, las tablas y `name_source`. Si diera *"type
   vector does not exist"*, habilita la extensión (paso 1) y reintenta.
3. **Copia el connection string** del **Session Pooler** (botón *Connect* →
   *Session pooler*): `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Añade `?sslmode=require`. Ese es tu `DATABASE_URL`.

> ⚠️ Usa el **Session pooler (puerto 5432)**, no el *Transaction pooler* (6543):
> el pooler de sesión es IPv4 (Render lo necesita) y soporta *prepared statements*
> (psycopg los usa). El *direct* `db.<ref>.supabase.co` es IPv6-only en free tier.

### Neon (alternativa)

Crea la base, pega `db/init.sql` en el SQL Editor, copia el string con
`?sslmode=require`. Ese es tu `DATABASE_URL`.

> El gateway activa TLS automáticamente cuando el string trae `sslmode`
> (ver [`gateway/src/db.ts`](../gateway/src/db.ts)); en local sin `sslmode` no usa SSL.

## 3. Deploy — un solo web service

Dos formas; ambas crean **un único servicio**:

**A) Blueprint (recomendado):** Render → **New → Blueprint** → conecta el repo
`AndresDFX/doble`. Lee `render.yaml` y crea el servicio `doble` ya configurado.

**B) Manual:** Render → **New → Web Service** → conecta el repo → Runtime
**Docker**, **Dockerfile Path** `Dockerfile.render`, **Docker Build Context Dir**
`.` (raíz), Health Check Path `/api/health`.

En ambos casos solo te queda llenar los secretos (`sync:false`):

| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | tu connection string de Neon (`?sslmode=require`) |
| `GEMINI_API_KEY` | tu API key de Gemini |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | las del IAM user de la tabla |
| `ADMIN_PASSWORD` | el password para entrar al dashboard (**obligatorio**) |

Todo lo demás (`WA_AUTH_STORE=dynamo`, `WA_AUTH_TABLE`, `WA_SESSION_ID`,
`AWS_REGION`, `GEMINI_*`, `ADMIN_USER`, y la URL interna del AI) ya viene fijado por
el Blueprint y la imagen. **No hay segundo servicio ni `AI_SERVICE_URL` que pegar.**

## 4. Vincular WhatsApp — desde tu IP, NO la de Render ⚠️

Igual que en `telegram-sender`: WhatsApp suele rechazar el linking (*"inténtalo más
tarde"*) cuando el socket sale de una **IP de datacenter**. Lo fiable es **vincular
localmente una vez** contra la **misma** tabla DynamoDB; la sesión queda ahí y
**Render la reutiliza** (reconectar una sesión existente no tiene ese bloqueo).

Para esto hay un script dedicado: **`npm run link`**. Solo abre el socket de Baileys
y guarda las credenciales — **no necesita Postgres ni el servicio AI**. Carga `.env`
y `.env.aws` automáticamente, así que tus credenciales AWS pueden vivir en `.env.aws`.

**1) Apunta al store de DynamoDB.** En `.env` (o `.env.aws`) — `DATABASE_URL` NO hace
falta para vincular:

```bash
WA_AUTH_STORE=dynamo
WA_AUTH_TABLE=doble-whatsapp-auth
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

**2) Vincula** (desde `gateway/`, en tu red residencial):

```powershell
cd gateway
npm run link                          # modo QR (escanéalo desde el teléfono)
npm run link -- --pair 573001234567   # alternativa: código de 8 dígitos
npm run link -- --reset               # si quedó en mal estado: borra y reintenta
```

El script imprime contra qué store va a vincular (confírmalo: debe decir
**DynamoDB** con tu tabla). Cuando muestre **`✅ CONECTADO`**, la sesión ya quedó en
DynamoDB; cierra con **Ctrl-C**.

**3) Reinicia el servicio en Render** (Dashboard → tu servicio → **Manual Deploy →
Restart service**). El servicio ya venía corriendo con la sesión vacía; al
reiniciar relee las credenciales desde DynamoDB y `/api/health` pasa a `wa: open`.

> **Un solo host activo a la vez.** No dejes el link local y el servicio de Render
> conectados con la misma sesión al tiempo: WhatsApp solo admite un socket por
> credencial y se patean (error 440). Vincula local, ciérralo, **luego** reinicia Render.
>
> Si `--pair`/QR falla repetidamente, WhatsApp bloquea ~30–60 min: espera y
> reintenta **una** vez. Ten el teléfono con WhatsApp actualizado y ≤4 dispositivos
> vinculados.

## 5. Keep-alive (el sleep de Render Free)

Render Free **duerme el servicio a los 15 min de inactividad** → el WebSocket de
WhatsApp se cae y se pierden mensajes entrantes hasta el siguiente arranque. Para un
agente *inbound* eso importa (a diferencia de telegram-sender, que solo difunde).

Mantenlo despierto con un ping externo a `/api/health` (queda fuera del Basic Auth)
cada <15 min — p. ej. [cron-job.org](https://cron-job.org) o UptimeRobot:

```
GET https://doble.onrender.com/api/health   cada 10 min
```

> Aun con keep-alive, Render recicla instancias y los redeploys cortan el socket;
> se recupera solo gracias a DynamoDB, pero con baches. Si quieres **always-on de
> verdad y perpetuo**, una VM **Oracle Cloud Always Free** corre el `docker compose`
> completo sin sleep — ver la comparativa en el README.

---

## Notas y límites

- **Bootstrap del RAG** (`npm run ingest-history`): córrelo **local** apuntando a
  Neon + DynamoDB, con el gateway de Render apagado (comparten sesión). Después,
  arranca Render.
- **El sender (cuenta A) NO se despliega.** Es tooling de prueba y usa tu número
  principal desde IP de datacenter (riesgo). Úsalo solo local (`WA_AUTH_STORE=files`,
  sesión en `.wa-sender-session/`).
- **Media efímera:** los audios/imágenes entrantes se bajan a disco, se transcriben
  y se embeben al instante; los transcripts quedan en Postgres. Perder el archivo en
  un spin-down no afecta el RAG.
- **Basic Auth** protege el dashboard público con un solo password compartido — no
  es multi-tenancy (sigue siendo single-user v1), solo candado de URL pública.
- **RAM (free = 512 MB):** el contenedor corre Node + Python juntos (~350–400 MB en
  reposo), así que cabe pero va justo. Si ves OOM/reinicios, sube de plan o separa
  el AI en un segundo servicio. La alternativa always-on perpetua sigue siendo una
  VM **Oracle Cloud Always Free** con el `docker compose` completo.
- **Ban de número:** IP de datacenter puede subir un poco el riesgo de Baileys vs
  IP residencial. Cadencia humana ya está implementada; usa número secundario.
