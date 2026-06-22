CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chats (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  label           TEXT,
  agent_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Teléfono del contacto (solo dígitos, sin '+'). Para @s.whatsapp.net sale del JID;
  -- para @lid se captura de key.senderPn cuando WhatsApp lo adjunta (puede quedar NULL).
  phone           TEXT,
  -- Mensajes proactivos: el agente escribe solo, cada cierto tiempo aleatorio, tomando el
  -- último contexto del chat. Opt-in POR CHAT (default OFF). Respeta draft_mode y se abstiene
  -- si no hay nada con fundamento que decir (no inventa). Ver gateway/src/application/proactive-messenger.ts.
  proactive_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Rango aleatorio (en minutos) entre disparos, configurable por chat.
  proactive_min_minutes  INT NOT NULL DEFAULT 1,
  proactive_max_minutes  INT NOT NULL DEFAULT 60,
  -- Próximo disparo programado (UTC). Se recalcula tras cada ciclo; null = no programado.
  proactive_next_ts      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Procedencia del nombre del chat: 'manual' (editado en el dashboard, máxima
-- prioridad), 'contact' (agenda de WhatsApp), 'push' (nombre auto-reportado /
-- pushName). NULL = sin nombre. La identificación de contactos rellena este
-- campo sin pisar nunca un nombre 'manual'.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS name_source TEXT;

-- Idempotente: init.sql solo corre auto en volumen nuevo; estos ALTER actualizan un postgres_data existente.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS proactive_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS proactive_min_minutes INT NOT NULL DEFAULT 1;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS proactive_max_minutes INT NOT NULL DEFAULT 60;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS proactive_next_ts TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS chats_label_idx ON chats(label);
-- Índice parcial para la consulta de "chats pendientes de disparo" del scheduler.
CREATE INDEX IF NOT EXISTS chats_proactive_due_idx ON chats(proactive_next_ts) WHERE proactive_enabled;

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  chat_id         TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  from_me         BOOLEAN NOT NULL,
  type            TEXT NOT NULL,
  content         TEXT,
  raw_media_path  TEXT,
  ts              TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_chat_ts_idx ON messages(chat_id, ts DESC);

CREATE TABLE IF NOT EXISTS labels_config (
  label             TEXT PRIMARY KEY,
  prompt_template   TEXT NOT NULL,
  temperature       REAL NOT NULL DEFAULT 0.7,
  -- Umbral de relevancia (distancia coseno máx.) para las slices por similitud del RAG.
  -- Más alto = más permisivo (entra más contexto, marcado por relevancia en el prompt);
  -- más bajo = más estricto. El juicio de tema lo hace el LLM; esto solo recorta ruido.
  max_distance      REAL NOT NULL DEFAULT 1.3,
  -- Ejemplos "de oro" curados (few-shot) de cómo responde el dueño en este tipo de chat.
  -- Anclan tono/registro mejor que el historial recuperado. Texto libre; opcional.
  examples          TEXT
);

-- Idempotente: añade las columnas a un postgres_data existente.
ALTER TABLE labels_config ADD COLUMN IF NOT EXISTS max_distance REAL NOT NULL DEFAULT 1.3;
ALTER TABLE labels_config ADD COLUMN IF NOT EXISTS examples TEXT;

INSERT INTO labels_config (label, prompt_template, temperature, examples) VALUES
  ('familia',  'Eres {user_name} hablando con familia. Tono cálido, cercano y relajado, en confianza; puedes mostrar interés genuino por cómo están. LÍMITES: no inventes planes, visitas, horas ni encargos que no estén en el contexto o las notas; si te preguntan por algo que no sabes (una cita, un mandado, plata), dilo o abstente, no improvises.', 0.8,
   'Mamá: "ya comiste?" -> "sí ma, todo bien, y ustedes?"
Tío: "cuando te apareces?" -> "de una de estas caigo, yo aviso"'),
  ('trabajo',  'Eres {user_name} con un contacto de trabajo. Profesional pero cercano, claro y conciso, sin formalismos excesivos ni jerga. LÍMITES: NO confirmes reuniones, fechas, entregables ni montos que no consten en el contexto/notas; no hagas promesas en nombre del dueño; ante un compromiso que no consta, abstente (need_info) en vez de comprometer algo.', 0.5,
   'Cliente: "quedamos el lunes?" -> "déjame confirmo y te aviso"
Colega: "me pasas el informe?" -> "claro, ya te lo mando"'),
  ('amigos',   'Eres {user_name} con un amigo. Relajado, con humor y jerga cuando aplique, sin forzarlo. LÍMITES: el humor NUNCA sustituye un dato — si te preguntan algo concreto que no sabes, no salgas con un chiste para taparlo, abstente. No inventes planes ni anécdotas.', 0.9,
   'Parce: "qué más, cómo va?" -> "ahí vamos parce, camellando"
Amigo: "jugamos el finde?" -> "de una, cuadremos hora"'),
  ('amor',     'Eres {user_name} con tu pareja. Cariñoso, cómplice y cercano. LÍMITES: NO inventes planes, sentimientos, recuerdos ni compromisos; si te preguntan por algo que no consta (una cita, una promesa, dónde estás), abstente con cariño en vez de inventar. La cercanía no justifica improvisar hechos.', 0.8,
   'Pareja: "me extrañas?" -> "obvio, un montón"
Pareja: "a qué hora sales?" -> "salgo ya, en nada estoy allá"'),
  ('default',  'Eres {user_name}. Adapta tu tono al historial del chat y a los mensajes de contexto. LÍMITES: ante cualquier dato que no esté en el contexto o las notas, abstente en vez de inventar.', 0.7, NULL),
  ('Owner',    'Eres {user_name}. Este chat es tu bandeja de avisos personal: aquí recibes notificaciones cuando el agente no supo responder en otros chats. Responde breve y directo.', 0.5, NULL)
ON CONFLICT (label) DO NOTHING;

CREATE TABLE IF NOT EXISTS message_embeddings (
  message_id   TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  label        TEXT,
  embedding    vector(1536) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_embeddings_chat_idx ON message_embeddings(chat_id);
CREATE INDEX IF NOT EXISTS message_embeddings_label_idx ON message_embeddings(label);
CREATE INDEX IF NOT EXISTS message_embeddings_ivfflat_idx
  ON message_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS agent_state (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  draft_mode    BOOLEAN NOT NULL DEFAULT TRUE,
  user_name     TEXT NOT NULL DEFAULT 'Yo',
  -- Instrucción global del dueño, inyectada en TODAS las respuestas (encima de la
  -- plantilla por etiqueta). Editable desde el dashboard. Vacío = sin efecto.
  global_prompt TEXT NOT NULL DEFAULT ''
);

-- Idempotente: actualiza un agent_state existente (init.sql solo corre auto en DB nueva).
ALTER TABLE agent_state ADD COLUMN IF NOT EXISTS global_prompt TEXT NOT NULL DEFAULT '';

INSERT INTO agent_state (id, enabled, draft_mode, user_name)
VALUES (1, TRUE, TRUE, 'Yo')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS drafts (
  id           BIGSERIAL PRIMARY KEY,
  chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  reply_to_id  TEXT REFERENCES messages(id) ON DELETE SET NULL,
  content      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  -- 'reply' = respuesta generada; 'needs_info' = abstención (el agente no supo y pide contexto).
  kind         TEXT NOT NULL DEFAULT 'reply',
  -- Para 'needs_info': descripción de una frase de qué dato falta.
  missing      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at      TIMESTAMPTZ
);

-- Idempotente: init.sql solo corre auto en volumen nuevo; estos ALTER permiten
-- actualizar un postgres_data existente (también se aplican manualmente, ver README/CLAUDE.md).
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'reply';
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS missing TEXT;

CREATE INDEX IF NOT EXISTS drafts_status_idx ON drafts(status, created_at);
