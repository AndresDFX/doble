# Desplegar Doble en Render (free tier)

Mismo patrón que el proyecto hermano `telegram-sender`: el servicio de WhatsApp
(Baileys) corre **always-on** y su **sesión vive en DynamoDB**, no en disco — así
el disco efímero de Render deja de importar (reinicios/spin-down **no** exigen
re-escanear el QR). Encima va **Basic Auth** porque el dashboard no tiene login.

> **Postgres+pgvector NO va en Render** (su Postgres free expira). Usa **Neon** o
> **Supabase** (ambos free, ambos traen pgvector). El servicio AI y el gateway
> comparten el mismo `DATABASE_URL`.

## Topología

```
Navegador ──Basic Auth──► doble-gateway (Render, Docker)
                            • Baileys (always-on)  ── sesión ──► DynamoDB
                            • admin API + dashboard (mismo origen)
                            • llama ──► doble-ai (Render, Docker) ── Gemini
                            └────────────────────────┬──────────► Neon/Supabase
                                                  (pgvector)
```

Todo se define en [`render.yaml`](../render.yaml) (Blueprint) + [`Dockerfile.render`](../Dockerfile.render).

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

## 2. Postgres + pgvector (Neon o Supabase)

1. Crea una base gratis en [neon.tech](https://neon.tech) (o supabase.com).
2. Aplica el schema: corre [`db/init.sql`](../db/init.sql) contra ella (incluye
   `CREATE EXTENSION vector` y las tablas). En Neon: SQL Editor → pega el archivo.
3. Copia el connection string (con `?sslmode=require`). Ese es tu `DATABASE_URL`
   para **ambos** servicios.

## 3. Deploy del Blueprint

1. En Render → **New → Blueprint** → conecta el repo `AndresDFX/doble`. Render lee
   `render.yaml` y crea `doble-gateway` + `doble-ai`.
2. Llena los secretos (`sync:false`) en cada servicio:
   - **doble-ai**: `DATABASE_URL`, `GEMINI_API_KEY`.
   - **doble-gateway**: `DATABASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
     `ADMIN_PASSWORD` (¡obligatorio!), y `AI_SERVICE_URL` = la URL pública de
     `doble-ai` (`https://doble-ai-xxxx.onrender.com`) una vez que ese servicio
     terminó su primer deploy.
3. Redeploy del gateway tras pegar `AI_SERVICE_URL`.

`WA_AUTH_STORE=dynamo`, `WA_AUTH_TABLE`, `AWS_REGION`, `ADMIN_USER` y `FRONTEND_DIST`
ya vienen fijados por el Blueprint/Dockerfile.

## 4. Vincular WhatsApp — desde tu IP, NO la de Render ⚠️

Igual que en `telegram-sender`: WhatsApp suele rechazar el linking (*"inténtalo más
tarde"*) cuando el socket sale de una **IP de datacenter**. Lo fiable es **vincular
localmente una vez** apuntando a la **misma** tabla DynamoDB; la sesión queda ahí y
**Render la reutiliza** (reconectar una sesión existente no tiene ese bloqueo).

En tu `.env` local, apunta al store remoto:

```bash
WA_AUTH_STORE=dynamo
WA_AUTH_TABLE=doble-whatsapp-auth
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
DATABASE_URL=postgresql://...neon.tech/...?sslmode=require
```

Levanta solo el gateway y escanea el QR (desde la terminal o `localhost:3000`):

```powershell
cd gateway ; npm run dev
```

Cuando diga "WhatsApp connection open", para el proceso (Ctrl-C). La sesión ya está
en DynamoDB → el gateway de Render la toma en su próximo arranque/deploy sin QR.

> **Un solo host activo a la vez.** No dejes el gateway local y el de Render
> conectados con la misma sesión al tiempo: WhatsApp solo admite un socket por
> credencial y se patean (error 440). Vincula local, apaga local, deja Render.

## 5. Keep-alive (el sleep de Render Free)

Render Free **duerme el servicio a los 15 min de inactividad** → el WebSocket de
WhatsApp se cae y se pierden mensajes entrantes hasta el siguiente arranque. Para un
agente *inbound* eso importa (a diferencia de telegram-sender, que solo difunde).

Mantenlo despierto con un ping externo a `/api/health` (queda fuera del Basic Auth)
cada <15 min — p. ej. [cron-job.org](https://cron-job.org) o UptimeRobot:

```
GET https://doble-gateway-xxxx.onrender.com/api/health   cada 10 min
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
- **Ban de número:** IP de datacenter puede subir un poco el riesgo de Baileys vs
  IP residencial. Cadencia humana ya está implementada; usa número secundario.
