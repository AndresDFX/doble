export type AgentState = {
  enabled: boolean;
  draft_mode: boolean;
  user_name: string;
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
  msgs: number;
  last_ts: string | null;
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
  created_at: string;
  sent_at: string | null;
  chat_name: string | null;
  chat_label: string | null;
};

export type Label = {
  label: string;
  prompt_template: string;
  temperature: number;
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

async function http<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
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
  },
  chats: {
    list: (params: { label?: string; q?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.label) search.set("label", params.label);
      if (params.q) search.set("q", params.q);
      return http<Chat[]>(`/api/chats?${search.toString()}`);
    },
    get: (id: string) => http<Chat>(`/api/chats/${encodeURIComponent(id)}`),
    patch: (id: string, body: { label?: string | null; agent_enabled?: boolean }) =>
      http<{ ok: true }>(`/api/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    messages: (id: string, limit = 50) =>
      http<Message[]>(
        `/api/chats/${encodeURIComponent(id)}/messages?limit=${limit}`
      ),
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
    upsert: (body: { label: string; prompt_template: string; temperature: number }) =>
      http<{ ok: true }>("/api/labels", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    patch: (
      label: string,
      body: { prompt_template?: string; temperature?: number }
    ) =>
      http<{ ok: true }>(`/api/labels/${encodeURIComponent(label)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (label: string) =>
      http<{ ok: true }>(`/api/labels/${encodeURIComponent(label)}`, {
        method: "DELETE",
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
