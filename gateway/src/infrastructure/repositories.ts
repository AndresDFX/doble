/**
 * Postgres repository adapters.
 *
 * Each class implements a domain repository port using the shared pg pool.
 * All SQL in the gateway's core lives here — controllers and use cases never
 * touch the database directly.
 */
import { pool } from "../db.js";
import { OWNER_CHAT_ID, OWNER_LABEL } from "../domain/entities.js";
import type {
  AgentState,
  AgentStatePatch,
  Chat,
  ChatListFilter,
  ChatBulkFilter,
  ChatPatch,
  ChatUpsert,
  ChatWithStats,
  ContactNameRecord,
  DraftInsert,
  DraftListFilter,
  DraftPatch,
  DraftRecord,
  DraftView,
  Label,
  LabelPatch,
  LabelWithStats,
  Message,
  MessageListFilter,
  MessageView,
  OwnerNote,
  OwnerNoteInsert,
  RagStats,
} from "../domain/entities.js";
import type {
  AgentStateRepository,
  ChatRepository,
  DraftRepository,
  LabelRepository,
  MessageRepository,
  OwnerNoteRepository,
  RagReadModel,
} from "../domain/ports.js";

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

// --- Agent state ------------------------------------------------------------

export class PostgresAgentStateRepository implements AgentStateRepository {
  async get(): Promise<AgentState> {
    const { rows } = await pool.query<AgentState>(
      "SELECT enabled, draft_mode, user_name, global_prompt FROM agent_state WHERE id = 1"
    );
    if (rows.length === 0) {
      throw new Error("agent_state row missing — did db/init.sql run?");
    }
    return rows[0]!;
  }

  async patch(patch: AgentStatePatch): Promise<AgentState> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (patch.enabled !== undefined) {
      sets.push(`enabled = $${i++}`);
      values.push(patch.enabled);
    }
    if (patch.draft_mode !== undefined) {
      sets.push(`draft_mode = $${i++}`);
      values.push(patch.draft_mode);
    }
    if (patch.user_name !== undefined) {
      sets.push(`user_name = $${i++}`);
      values.push(patch.user_name);
    }
    if (patch.global_prompt !== undefined) {
      sets.push(`global_prompt = $${i++}`);
      values.push(patch.global_prompt);
    }
    if (sets.length > 0) {
      await pool.query(`UPDATE agent_state SET ${sets.join(", ")} WHERE id = 1`, values);
    }
    return this.get();
  }
}

// --- Chats ------------------------------------------------------------------

// Columns shared by every chat SELECT — keeps the proactive fields in one place.
const CHAT_COLS =
  "c.id, c.name, c.label, c.agent_enabled, c.phone, " +
  "c.proactive_enabled, c.proactive_min_minutes, c.proactive_max_minutes, c.proactive_next_ts";

type ChatRow = {
  id: string;
  name: string | null;
  label: string | null;
  agent_enabled: boolean;
  phone: string | null;
  proactive_enabled: boolean;
  proactive_min_minutes: number;
  proactive_max_minutes: number;
  proactive_next_ts: Date | null;
};
type ChatStatsRow = ChatRow & {
  msgs: number;
  last_ts: Date | null;
};

/** Map a DB row to the domain `Chat` (timestamps as ISO strings). */
const toChat = (r: ChatRow): Chat => ({
  id: r.id,
  name: r.name,
  label: r.label,
  agent_enabled: r.agent_enabled,
  phone: r.phone,
  proactive_enabled: r.proactive_enabled,
  proactive_min_minutes: r.proactive_min_minutes,
  proactive_max_minutes: r.proactive_max_minutes,
  proactive_next_ts: iso(r.proactive_next_ts),
});

export class PostgresChatRepository implements ChatRepository {
  async get(id: string): Promise<Chat | null> {
    const { rows } = await pool.query<ChatRow>(
      `SELECT id, name, label, agent_enabled, phone,
              proactive_enabled, proactive_min_minutes, proactive_max_minutes, proactive_next_ts
       FROM chats WHERE id = $1`,
      [id]
    );
    return rows[0] ? toChat(rows[0]) : null;
  }

  async getWithStats(id: string): Promise<ChatWithStats | null> {
    const { rows } = await pool.query<ChatStatsRow>(
      `SELECT ${CHAT_COLS},
              COALESCE(stats.msgs, 0)::int AS msgs, stats.last_ts
       FROM chats c
       LEFT JOIN (
         SELECT chat_id, COUNT(*) AS msgs, MAX(ts) AS last_ts
         FROM messages WHERE chat_id = $1 GROUP BY chat_id
       ) stats ON stats.chat_id = c.id
       WHERE c.id = $1`,
      [id]
    );
    const r = rows[0];
    return r ? { ...toChat(r), msgs: r.msgs, last_ts: iso(r.last_ts) } : null;
  }

  async list(filter: ChatListFilter): Promise<ChatWithStats[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (filter.label) {
      where.push(`c.label = $${i++}`);
      values.push(filter.label);
    }
    if (filter.q) {
      where.push(`(c.name ILIKE $${i} OR c.id ILIKE $${i})`);
      values.push(`%${filter.q}%`);
      i++;
    }
    values.push(filter.limit ?? 100, filter.offset ?? 0);
    const sql = `
      SELECT ${CHAT_COLS},
             COALESCE(stats.msgs, 0)::int AS msgs,
             stats.last_ts
      FROM chats c
      LEFT JOIN (
        SELECT chat_id, COUNT(*) AS msgs, MAX(ts) AS last_ts
        FROM messages GROUP BY chat_id
      ) stats ON stats.chat_id = c.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY stats.last_ts DESC NULLS LAST
      LIMIT $${i++} OFFSET $${i++}
    `;
    const { rows } = await pool.query<ChatStatsRow>(sql, values);
    return rows.map((r) => ({ ...toChat(r), msgs: r.msgs, last_ts: iso(r.last_ts) }));
  }

  async upsert(chat: ChatUpsert): Promise<void> {
    await pool.query(
      `INSERT INTO chats (id, name, label, phone) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, chats.name),
         label = COALESCE(EXCLUDED.label, chats.label),
         phone = COALESCE(chats.phone, EXCLUDED.phone)`,
      [chat.id, chat.name ?? null, chat.label ?? null, chat.phone ?? null]
    );
  }

  async patch(id: string, patch: ChatPatch): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (patch.label !== undefined) {
      sets.push(`label = $${i++}`);
      values.push(patch.label);
    }
    if (patch.agent_enabled !== undefined) {
      sets.push(`agent_enabled = $${i++}`);
      values.push(patch.agent_enabled);
    }
    if (patch.name !== undefined) {
      sets.push(`name = $${i++}`);
      values.push(patch.name);
      // A dashboard edit is authoritative: mark it 'manual' (or clear the source
      // when the name is cleared) so contact identification won't overwrite it.
      sets.push(`name_source = $${i++}`);
      values.push(patch.name == null || patch.name === "" ? null : "manual");
    }
    if (patch.proactive_enabled !== undefined) {
      sets.push(`proactive_enabled = $${i++}`);
      values.push(patch.proactive_enabled);
    }
    if (patch.proactive_min_minutes !== undefined) {
      sets.push(`proactive_min_minutes = $${i++}`);
      values.push(patch.proactive_min_minutes);
    }
    if (patch.proactive_max_minutes !== undefined) {
      sets.push(`proactive_max_minutes = $${i++}`);
      values.push(patch.proactive_max_minutes);
    }
    if (patch.proactive_next_ts !== undefined) {
      sets.push(`proactive_next_ts = $${i++}`);
      values.push(patch.proactive_next_ts);
    }
    if (sets.length === 0) return;
    values.push(id);
    await pool.query(`UPDATE chats SET ${sets.join(", ")} WHERE id = $${i}`, values);
  }

  // Precedence of a name_source value as a SQL expression: manual(3) > contact(2)
  // > push(1) > none(0). Used to decide whether an incoming name may overwrite.
  private static readonly PRIO = (col: string) =>
    `(CASE ${col} WHEN 'manual' THEN 3 WHEN 'contact' THEN 2 WHEN 'push' THEN 1 ELSE 0 END)`;

  async recordContactNames(records: ContactNameRecord[]): Promise<number> {
    // Dedupe by id within the batch (a row can't be matched twice in UPDATE..FROM),
    // keeping the highest-precedence record per id.
    const prio = { manual: 3, contact: 2, push: 1 } as const;
    const byId = new Map<string, ContactNameRecord>();
    for (const r of records) {
      const name = r.name?.trim();
      if (!r.id || !name) continue;
      const prev = byId.get(r.id);
      if (!prev || prio[r.source] >= prio[prev.source]) byId.set(r.id, { ...r, name });
    }
    const list = [...byId.values()];
    if (list.length === 0) return 0;

    const values: unknown[] = [];
    const tuples = list.map((r, n) => {
      values.push(r.id, r.name, r.source);
      return `($${n * 3 + 1}, $${n * 3 + 2}, $${n * 3 + 3})`;
    });
    // Update-only: Doble's `chats` are conversations, not the whole address book.
    // We name chats that already exist; we never create a row per contact (that
    // would flood the Chats list). The incoming pipeline creates the chat row;
    // here we just attach/upgrade its name when the new source has >= precedence.
    const vPrio = PostgresChatRepository.PRIO("v.name_source");
    const cPrio = PostgresChatRepository.PRIO("chats.name_source");
    const { rowCount } = await pool.query(
      `UPDATE chats SET name = v.name, name_source = v.name_source
       FROM (VALUES ${tuples.join(", ")}) AS v(id, name, name_source)
       WHERE chats.id = v.id
         AND COALESCE(v.name, '') <> ''
         AND ${vPrio} >= ${cPrio}`,
      values
    );
    return rowCount ?? 0;
  }

  async countNamed(): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM chats WHERE name IS NOT NULL AND name <> ''"
    );
    return rows[0]?.n ?? 0;
  }

  async bulkSetAgentEnabled(filter: ChatBulkFilter, enabled: boolean): Promise<number> {
    // Mirror list()'s matching (substring q over name+id, plus label). The owner
    // pseudo-chat is always excluded.
    const where = ["id <> $1"];
    const values: unknown[] = [OWNER_CHAT_ID, enabled];
    let i = 3;
    if (filter.label) {
      where.push(`label = $${i++}`);
      values.push(filter.label);
    }
    if (filter.q) {
      where.push(`(name ILIKE $${i} OR id ILIKE $${i})`);
      values.push(`%${filter.q}%`);
      i++;
    }
    const { rowCount } = await pool.query(
      `UPDATE chats SET agent_enabled = $2 WHERE ${where.join(" AND ")}`,
      values
    );
    return rowCount ?? 0;
  }

  async ensureOwnerChat(): Promise<void> {
    await pool.query(
      `INSERT INTO chats (id, name, label, agent_enabled)
       VALUES ($1, 'Notas del dueño', $2, FALSE)
       ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label`,
      [OWNER_CHAT_ID, OWNER_LABEL]
    );
  }

  async listProactiveDue(now: Date): Promise<Chat[]> {
    const { rows } = await pool.query<ChatRow>(
      `SELECT id, name, label, agent_enabled, phone,
              proactive_enabled, proactive_min_minutes, proactive_max_minutes, proactive_next_ts
       FROM chats
       WHERE proactive_enabled = TRUE
         AND proactive_next_ts IS NOT NULL
         AND proactive_next_ts <= $1
         AND id <> $2
       ORDER BY proactive_next_ts ASC`,
      [now, OWNER_CHAT_ID]
    );
    return rows.map(toChat);
  }
}

// --- Messages ---------------------------------------------------------------

export class PostgresMessageRepository implements MessageRepository {
  async insert(m: Message): Promise<void> {
    await pool.query(
      `INSERT INTO messages (id, chat_id, from_me, type, content, raw_media_path, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [m.id, m.chat_id, m.from_me, m.type, m.content, m.raw_media_path, m.ts]
    );
  }

  async updateContent(id: string, content: string): Promise<void> {
    await pool.query("UPDATE messages SET content = $1 WHERE id = $2", [content, id]);
  }

  async getContent(id: string): Promise<string | null> {
    const { rows } = await pool.query<{ content: string | null }>(
      "SELECT content FROM messages WHERE id = $1",
      [id]
    );
    return rows[0]?.content ?? null;
  }

  async listByChat(filter: MessageListFilter): Promise<MessageView[]> {
    const limit = Math.min(filter.limit ?? 50, 500);
    const where = ["chat_id = $1"];
    const values: unknown[] = [filter.chatId];
    if (filter.before) {
      where.push("ts < $2");
      values.push(new Date(filter.before));
    }
    values.push(limit);
    const { rows } = await pool.query<{
      id: string;
      chat_id: string;
      from_me: boolean;
      type: string;
      content: string | null;
      ts: Date;
    }>(
      `SELECT id, chat_id, from_me, type, content, ts
       FROM messages
       WHERE ${where.join(" AND ")}
       ORDER BY ts DESC
       LIMIT $${values.length}`,
      values
    );
    return rows.map((r) => ({ ...r, ts: iso(r.ts)! }));
  }
}

// --- Drafts -----------------------------------------------------------------

export class PostgresDraftRepository implements DraftRepository {
  async insert(d: DraftInsert): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO drafts (chat_id, reply_to_id, content, kind, missing)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [d.chat_id, d.reply_to_id, d.content, d.kind ?? "reply", d.missing ?? null]
    );
    return rows[0]!.id;
  }

  async list(filter: DraftListFilter): Promise<DraftView[]> {
    const where: string[] = ["status = $1"];
    const values: unknown[] = [filter.status ?? "pending"];
    let i = 2;
    if (filter.chatId) {
      where.push(`chat_id = $${i++}`);
      values.push(filter.chatId);
    }
    values.push(filter.limit ?? 100);
    const { rows } = await pool.query<{
      id: number;
      chat_id: string;
      reply_to_id: string | null;
      content: string;
      status: DraftView["status"];
      kind: DraftView["kind"];
      missing: string | null;
      created_at: Date;
      sent_at: Date | null;
      chat_name: string | null;
      chat_label: string | null;
    }>(
      `SELECT d.id, d.chat_id, d.reply_to_id, d.content, d.status, d.kind, d.missing,
              d.created_at, d.sent_at,
              c.name AS chat_name, c.label AS chat_label
       FROM drafts d
       LEFT JOIN chats c ON c.id = d.chat_id
       WHERE ${where.join(" AND ")}
       ORDER BY d.created_at DESC
       LIMIT $${i}`,
      values
    );
    return rows.map((r) => ({
      ...r,
      created_at: iso(r.created_at)!,
      sent_at: iso(r.sent_at),
    }));
  }

  async getById(id: number): Promise<DraftRecord | null> {
    const { rows } = await pool.query<DraftRecord>(
      "SELECT id, chat_id, content, status, kind FROM drafts WHERE id = $1",
      [id]
    );
    return rows[0] ?? null;
  }

  async patch(id: number, patch: DraftPatch): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (patch.status) {
      sets.push(`status = $${i++}`);
      values.push(patch.status);
    }
    if (patch.content !== undefined) {
      sets.push(`content = $${i++}`);
      values.push(patch.content);
    }
    if (sets.length === 0) return;
    values.push(id);
    await pool.query(`UPDATE drafts SET ${sets.join(", ")} WHERE id = $${i}`, values);
  }

  async markSent(id: number): Promise<void> {
    await pool.query("UPDATE drafts SET status = 'sent', sent_at = NOW() WHERE id = $1", [id]);
  }

  async delete(id: number): Promise<void> {
    await pool.query("DELETE FROM drafts WHERE id = $1", [id]);
  }
}

// --- Labels -----------------------------------------------------------------

export class PostgresLabelRepository implements LabelRepository {
  async list(): Promise<LabelWithStats[]> {
    const { rows } = await pool.query<LabelWithStats>(
      `SELECT lc.label, lc.prompt_template, lc.temperature, lc.max_distance, lc.examples,
              COALESCE(stats.chats, 0)::int AS chats
       FROM labels_config lc
       LEFT JOIN (
         SELECT label, COUNT(*) AS chats FROM chats WHERE label IS NOT NULL GROUP BY label
       ) stats ON stats.label = lc.label
       ORDER BY lc.label`
    );
    return rows;
  }

  async upsert(label: Label): Promise<void> {
    await pool.query(
      `INSERT INTO labels_config (label, prompt_template, temperature, max_distance, examples)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (label) DO UPDATE SET
         prompt_template = EXCLUDED.prompt_template,
         temperature = EXCLUDED.temperature,
         max_distance = EXCLUDED.max_distance,
         examples = EXCLUDED.examples`,
      [
        label.label,
        label.prompt_template,
        label.temperature ?? 0.7,
        label.max_distance ?? 1.3,
        label.examples ?? null,
      ]
    );
  }

  async patch(label: string, patch: LabelPatch): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (patch.prompt_template !== undefined) {
      sets.push(`prompt_template = $${i++}`);
      values.push(patch.prompt_template);
    }
    if (patch.temperature !== undefined) {
      sets.push(`temperature = $${i++}`);
      values.push(patch.temperature);
    }
    if (patch.max_distance !== undefined) {
      sets.push(`max_distance = $${i++}`);
      values.push(patch.max_distance);
    }
    if (patch.examples !== undefined) {
      sets.push(`examples = $${i++}`);
      values.push(patch.examples);
    }
    if (sets.length === 0) return;
    values.push(label);
    await pool.query(`UPDATE labels_config SET ${sets.join(", ")} WHERE label = $${i}`, values);
  }

  async countChats(label: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM chats WHERE label = $1",
      [label]
    );
    return Number(rows[0]?.count ?? "0");
  }

  async delete(label: string): Promise<void> {
    await pool.query("DELETE FROM labels_config WHERE label = $1", [label]);
  }
}

// --- Owner notes ------------------------------------------------------------

export class PostgresOwnerNoteRepository implements OwnerNoteRepository {
  async list(): Promise<OwnerNote[]> {
    const { rows } = await pool.query<{
      id: string;
      content: string;
      raw_media_path: string | null;
      ts: Date;
      embedded: boolean;
    }>(
      `SELECT m.id, m.content, m.raw_media_path, m.ts,
              EXISTS(SELECT 1 FROM message_embeddings WHERE message_id = m.id) AS embedded
       FROM messages m
       WHERE m.chat_id = $1
       ORDER BY m.ts DESC`,
      [OWNER_CHAT_ID]
    );
    return rows.map((r) => ({ ...r, ts: iso(r.ts)! }));
  }

  async create(note: OwnerNoteInsert): Promise<void> {
    await pool.query(
      `INSERT INTO messages (id, chat_id, from_me, type, content, raw_media_path, ts)
       VALUES ($1, $2, TRUE, 'note', $3, $4, $5)`,
      [note.id, OWNER_CHAT_ID, note.content, note.raw_media_path ?? null, note.ts]
    );
  }

  async update(id: string, content: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE messages SET content = $1 WHERE id = $2 AND chat_id = $3`,
      [content, id, OWNER_CHAT_ID]
    );
    return (rowCount ?? 0) > 0;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM messages WHERE id = $1 AND chat_id = $2`,
      [id, OWNER_CHAT_ID]
    );
    return (rowCount ?? 0) > 0;
  }
}

// --- RAG read model ---------------------------------------------------------

export class PostgresRagReadModel implements RagReadModel {
  async stats(): Promise<RagStats> {
    const [totals, byLabel, byChat, coverage] = await Promise.all([
      pool.query<{ embeddings: string }>(
        "SELECT COUNT(*)::text AS embeddings FROM message_embeddings"
      ),
      pool.query<{ label: string | null; embeddings: string; chats: string }>(
        `SELECT label,
                COUNT(*)::text AS embeddings,
                COUNT(DISTINCT chat_id)::text AS chats
         FROM message_embeddings
         GROUP BY label
         ORDER BY COUNT(*) DESC`
      ),
      pool.query<{
        chat_id: string;
        name: string | null;
        label: string | null;
        embeddings: string;
      }>(
        `SELECT e.chat_id, c.name, c.label, COUNT(*)::text AS embeddings
         FROM message_embeddings e
         LEFT JOIN chats c ON c.id = e.chat_id
         GROUP BY e.chat_id, c.name, c.label
         ORDER BY COUNT(*) DESC
         LIMIT 25`
      ),
      pool.query<{ messages: string; embedded: string }>(
        `SELECT
           (SELECT COUNT(*) FROM messages
            WHERE content IS NOT NULL AND length(trim(content)) > 0)::text AS messages,
           (SELECT COUNT(*) FROM message_embeddings)::text AS embedded`
      ),
    ]);

    return {
      total_embeddings: Number(totals.rows[0]?.embeddings ?? 0),
      by_label: byLabel.rows.map((r) => ({
        label: r.label,
        embeddings: Number(r.embeddings),
        chats: Number(r.chats),
      })),
      top_chats: byChat.rows.map((r) => ({
        chat_id: r.chat_id,
        name: r.name,
        label: r.label,
        embeddings: Number(r.embeddings),
      })),
      coverage: {
        messages_with_content: Number(coverage.rows[0]?.messages ?? 0),
        embedded: Number(coverage.rows[0]?.embedded ?? 0),
      },
    };
  }
}
