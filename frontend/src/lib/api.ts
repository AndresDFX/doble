export type AgentState = {
  enabled: boolean;
  draft_mode: boolean;
  user_name: string;
  global_prompt: string;
};

export type WaStatus = {
  connection: "connecting" | "open" | "close";
  qr: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  lastChangeAt: string;
  me: { id: string | null; name: string | null };
};

export type Health = {
  gateway: "ok";
  db: "ok" | "down";
  ai: "ok" | "down";
  wa: WaStatus["connection"];
  at: string;
};

export type Chat = {
  id: string;
  name: string | null;
  label: string | null;
  agent_enabled: boolean;
  phone: string | null;
  proactive_enabled: boolean;
  proactive_min_minutes: number;
  proactive_max_minutes: number;
  proactive_next_ts: string | null;
  msgs: number;
  last_ts: string | null;
};

export type ChatPatchBody = {
  label?: string | null;
  agent_enabled?: boolean;
  name?: string | null;
  proactive_enabled?: boolean;
  proactive_min_minutes?: number;
  proactive_max_minutes?: number;
};

export type Message = {
  id: string;
  chat_id: string;
  from_me: boolean;
  type: string;
  content: string | null;
  ts: string;
};

export type Draft = {
  id: number;
  chat_id: string;
  reply_to_id: string | null;
  content: string;
  status: "pending" | "approved" | "sent" | "discarded";
  kind: "reply" | "needs_info";
  missing: string | null;
  created_at: string;
  sent_at: string | null;
  chat_name: string | null;
  chat_label: string | null;
};

export type Label = {
  label: string;
  prompt_template: string;
  temperature: number;
  max_distance: number;
  examples: string | null;
  chats: number;
};

export type ActivityKind =
  | "wa"
  | "sender"
  | "message-in"
  | "message-out"
  | "draft"
  | "ai"
  | "batch"
  | "system"
  | "error";

export type Activity = {
  id: number;
  ts: string;
  kind: ActivityKind;
  level: "info" | "success" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
};

export type SenderStatus = {
  connection: "idle" | "connecting" | "open" | "close";
  qr: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  lastChangeAt: string;
  me: { id: string | null; name: string | null };
};

export type CatalogTheme = {
  theme: string;
  count: number;
  samples: string[];
};

export type BatchState = {
  id: string | null;
  status: "idle" | "running" | "done" | "failed";
  total: number;
  sent: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export type BatchSpec = {
  to: string;
  themes?: string[];
  count?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  dry?: boolean;
};

export type RagStats = {
  total_embeddings: number;
  by_label: { label: string | null; embeddings: number; chats: number }[];
  top_chats: { chat_id: string; name: string | null; label: string | null; embeddings: number }[];
  coverage: { messages_with_content: number; embedded: number };
};

export type RagMatch = {
  message_id: string;
  chat_id: string;
  label: string | null;
  content: string;
  from_me: boolean;
  ts: string;
  distance: number;
  similarity: number;
};

export type RagRetrieveResponse = {
  embedding_dim: number;
  chat_label: string | null;
  matches: RagMatch[];
};

export type RagRetrieveRequest = {
  query: string;
  chat_id?: string;
  label?: string;
  k_chat?: number;
  k_label?: number;
};

export type OwnerNote = {
  id: string;
  content: string;
  raw_media_path: string | null;
  ts: string;
  embedded: boolean;
};

export type TranscribeResponse = {
  text: string;
  raw_media_path: string;
};

async function http<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  // Only advertise a JSON body when we actually send one. A bodyless POST/DELETE
  // (e.g. /api/wa/relink) with content-type: application/json makes Fastify 400
  // ("Body cannot be empty when content-type is set to 'application/json'").
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
  if (init.body != null && !hasContentType) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => http<Health>("/api/health"),
  state: {
    get: () => http<AgentState>("/api/state"),
    patch: (body: Partial<AgentState>) =>
      http<AgentState>("/api/state", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  },
  wa: {
    status: () => http<WaStatus>("/api/wa/status"),
    relink: () => http<{ ok: true }>("/api/wa/relink", { method: "POST" }),
  },
  chats: {
    list: (params: { label?: string; q?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.label) search.set("label", params.label);
      if (params.q) search.set("q", params.q);
      return http<Chat[]>(`/api/chats?${search.toString()}`);
    },
    get: (id: string) => http<Chat>(`/api/chats/${encodeURIComponent(id)}`),
    patch: (id: string, body: ChatPatchBody) =>
      http<{ ok: true }>(`/api/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    messages: (id: string, limit = 50) =>
      http<Message[]>(
        `/api/chats/${encodeURIComponent(id)}/messages?limit=${limit}`
      ),
    bulkAgent: (body: { q?: string; label?: string; agent_enabled: boolean }) =>
      http<{ updated: number }>("/api/chats/bulk-agent", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  drafts: {
    list: (status: Draft["status"] = "pending") =>
      http<Draft[]>(`/api/drafts?status=${status}`),
    patch: (id: number, body: { status?: Draft["status"]; content?: string }) =>
      http<{ ok: true }>(`/api/drafts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    send: (id: number) =>
      http<{ ok: true }>(`/api/drafts/${id}/send`, { method: "POST" }),
    discard: (id: number) =>
      http<{ ok: true }>(`/api/drafts/${id}`, { method: "DELETE" }),
  },
  labels: {
    list: () => http<Label[]>("/api/labels"),
    upsert: (body: {
      label: string;
      prompt_template: string;
      temperature: number;
      max_distance?: number;
      examples?: string | null;
    }) =>
      http<{ ok: true }>("/api/labels", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    patch: (
      label: string,
      body: {
        prompt_template?: string;
        temperature?: number;
        max_distance?: number;
        examples?: string | null;
      }
    ) =>
      http<{ ok: true }>(`/api/labels/${encodeURIComponent(label)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (label: string) =>
      http<{ ok: true }>(`/api/labels/${encodeURIComponent(label)}`, {
        method: "DELETE",
      }),
    base: () => http<Omit<Label, "chats">[]>("/api/labels/base"),
    reset: (label: string) =>
      http<{ ok: true }>(`/api/labels/${encodeURIComponent(label)}/reset`, {
        method: "POST",
      }),
  },
  activity: {
    list: (limit = 200, kind?: ActivityKind) => {
      const search = new URLSearchParams();
      search.set("limit", String(limit));
      if (kind) search.set("kind", kind);
      return http<Activity[]>(`/api/activity?${search.toString()}`);
    },
    clear: () => http<{ ok: true }>("/api/activity", { method: "DELETE" }),
  },
  ownerNotes: {
    list: () => http<OwnerNote[]>("/api/owner-notes"),
    transcribe: async (audio: Blob, filename: string): Promise<TranscribeResponse> => {
      const form = new FormData();
      form.append("file", audio, filename);
      const res = await fetch("/api/owner-notes/transcribe", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json() as Promise<TranscribeResponse>;
    },
    create: (body: { content: string; raw_media_path?: string | null }) =>
      http<OwnerNote>("/api/owner-notes", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { content: string }) =>
      http<{ ok: true }>(`/api/owner-notes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      http<{ ok: true }>(`/api/owner-notes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
  },
  rag: {
    stats: () => http<RagStats>("/api/rag/stats"),
    retrieve: (body: RagRetrieveRequest) =>
      http<RagRetrieveResponse>("/api/rag/retrieve", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  sender: {
    status: () => http<SenderStatus>("/api/sender/status"),
    connect: () => http<SenderStatus>("/api/sender/connect", { method: "POST" }),
    disconnect: () => http<SenderStatus>("/api/sender/disconnect", { method: "POST" }),
    purge: () => http<SenderStatus>("/api/sender/session", { method: "DELETE" }),
    catalog: () => http<CatalogTheme[]>("/api/sender/catalog"),
    batchState: () => http<BatchState>("/api/sender/batch"),
    startBatch: (body: BatchSpec) =>
      http<BatchState>("/api/sender/batch", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    abortBatch: () => http<{ aborted: boolean }>("/api/sender/batch", { method: "DELETE" }),
  },
};
