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
};
