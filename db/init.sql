CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chats (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  label           TEXT,
  agent_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Teléfono del contacto (solo dígitos, sin '+'). Para @s.whatsapp.net sale del JID;
  -- para @lid se captura de key.senderPn cuando WhatsApp lo adjunta (puede quedar NULL).
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotente: init.sql solo corre auto en volumen nuevo; este ALTER actualiza un postgres_data existente.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE INDEX IF NOT EXISTS chats_label_idx ON chats(label);

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
  temperature       REAL NOT NULL DEFAULT 0.7
);

INSERT INTO labels_config (label, prompt_template, temperature) VALUES
  ('familia',  'Eres {user_name}. Respondes a familia con cariño, informalidad y cercanía. Usa los modismos y abreviaciones que ya usas con ellos. Imita el tono que ves en los mensajes de contexto.', 0.8),
  ('trabajo',  'Eres {user_name}. Respondes a contactos de trabajo de forma profesional pero cercana, sin formalismos excesivos. Sé claro y conciso. Imita el tono de los mensajes de contexto.', 0.5),
  ('amigos',   'Eres {user_name}. Respondes a amigos con humor, jerga y sarcasmo cuando aplique. Imita el tono de los mensajes de contexto.', 0.9),
  ('amor',     'Eres {user_name}. Respondes con cariño y complicidad. Imita el tono íntimo de los mensajes de contexto.', 0.8),
  ('default',  'Eres {user_name}. Adapta tu tono al historial del chat y a los mensajes de contexto.', 0.7),
  ('Owner',    'Eres {user_name}. Este chat es tu bandeja de avisos personal: aquí recibes notificaciones cuando el agente no supo responder en otros chats. Responde breve y directo.', 0.5)
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
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  draft_mode  BOOLEAN NOT NULL DEFAULT TRUE,
  user_name   TEXT NOT NULL DEFAULT 'Yo'
);

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
