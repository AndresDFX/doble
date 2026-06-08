import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type RagRetrieveRequest } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
} from "../components/ui";
import { cn } from "../lib/cn";
import { Database, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function Rag() {
  const statsQ = useQuery({
    queryKey: ["rag-stats"],
    queryFn: api.rag.stats,
    refetchInterval: 15_000,
  });
  const chatsQ = useQuery({ queryKey: ["chats"], queryFn: () => api.chats.list({}) });
  const labelsQ = useQuery({ queryKey: ["labels"], queryFn: api.labels.list });

  return (
    <div className="space-y-4">
      <StatsRow stats={statsQ.data} loading={statsQ.isLoading} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LabelsCard stats={statsQ.data} />
        <TopChatsCard stats={statsQ.data} />
      </div>
      <Explorer chats={chatsQ.data ?? []} labels={labelsQ.data?.map((l) => l.label) ?? []} />
    </div>
  );
}

function StatsRow({
  stats,
  loading,
}: {
  stats: ReturnType<typeof api.rag.stats> extends Promise<infer T> ? T | undefined : never;
  loading: boolean;
}) {
  const coveragePct =
    stats && stats.coverage.messages_with_content > 0
      ? Math.round(
          (stats.coverage.embedded / stats.coverage.messages_with_content) * 100
        )
      : 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card>
        <CardBody className="flex items-center gap-3">
          <div className="rounded-lg bg-fuchsia-500/15 p-2 text-fuchsia-300">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-zinc-500">Embeddings totales</div>
            <div className="text-2xl font-semibold text-zinc-100">
              {loading ? "…" : (stats?.total_embeddings ?? 0).toLocaleString()}
            </div>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="mb-1 text-xs text-zinc-500">Cobertura</div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-zinc-100">{coveragePct}%</span>
            <span className="text-xs text-zinc-500">
              {stats?.coverage.embedded.toLocaleString() ?? 0} de{" "}
              {stats?.coverage.messages_with_content.toLocaleString() ?? 0} mensajes
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-fuchsia-500" style={{ width: `${coveragePct}%` }} />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="text-xs text-zinc-500">Etiquetas con embeddings</div>
          <div className="text-2xl font-semibold text-zinc-100">
            {stats?.by_label.length ?? 0}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            (incluye nulos: chats sin etiqueta asignada)
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function LabelsCard({
  stats,
}: {
  stats: ReturnType<typeof api.rag.stats> extends Promise<infer T> ? T | undefined : never;
}) {
  const rows = stats?.by_label ?? [];
  const max = rows.reduce((m, r) => Math.max(m, r.embeddings), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Por etiqueta</CardTitle>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState>Sin embeddings todavía.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const pct = max ? (r.embeddings / max) * 100 : 0;
              return (
                <li key={r.label ?? "_null"} className="text-sm">
                  <div className="flex items-center justify-between text-zinc-300">
                    <span className="font-medium">{r.label ?? <em className="text-zinc-500">sin etiqueta</em>}</span>
                    <span className="text-xs text-zinc-500">
                      {r.embeddings.toLocaleString()} embs · {r.chats} chats
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full bg-fuchsia-500/70" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function TopChatsCard({
  stats,
}: {
  stats: ReturnType<typeof api.rag.stats> extends Promise<infer T> ? T | undefined : never;
}) {
  const rows = stats?.top_chats ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chats con más material RAG</CardTitle>
      </CardHeader>
      <CardBody className="max-h-[28rem] overflow-auto p-0">
        {rows.length === 0 ? (
          <EmptyState>Sin datos aún.</EmptyState>
        ) : (
          <table className="w-full min-w-[22rem] text-sm">
            <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Chat</th>
                <th className="px-3 py-2 text-left">Etiqueta</th>
                <th className="px-3 py-2 text-right">Embs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.chat_id} className="border-t border-zinc-800">
                  <td className="px-3 py-1.5">
                    <div className="text-zinc-200">{r.name ?? "(sin nombre)"}</div>
                    <div className="font-mono text-[10px] text-zinc-500">{r.chat_id}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    {r.label ? <Badge tone="blue">{r.label}</Badge> : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right text-zinc-300">{r.embeddings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

function Explorer({
  chats,
  labels,
}: {
  chats: { id: string; name: string | null; label: string | null }[];
  labels: string[];
}) {
  const [query, setQuery] = useState("");
  const [chatId, setChatId] = useState<string>("");
  const [labelOverride, setLabelOverride] = useState<string>("");
  const [kChat, setKChat] = useState(8);
  const [kLabel, setKLabel] = useState(4);
  const [chatSearch, setChatSearch] = useState("");

  const filteredChats = useMemo(() => {
    const q = chatSearch.toLowerCase();
    return chats
      .filter(
        (c) =>
          !q ||
          (c.name ?? "").toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [chats, chatSearch]);

  const retrieve = useMutation({
    mutationFn: (body: RagRetrieveRequest) => api.rag.retrieve(body),
    onError: (err: Error) => toast.error(err.message),
  });

  const result = retrieve.data;
  const matches = result?.matches ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Explorar retrieval</CardTitle>
        {result ? (
          <span className="text-xs text-zinc-500">
            dim={result.embedding_dim} · label={result.chat_label ?? "—"}
          </span>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Query (mensaje hipotético)</label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="¿cómo va eso?"
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim()) {
                  retrieve.mutate({
                    query,
                    chat_id: chatId || undefined,
                    label: labelOverride || undefined,
                    k_chat: kChat,
                    k_label: kLabel,
                  });
                }
              }}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">k_chat</label>
              <Input
                type="number"
                min={0}
                max={50}
                value={kChat}
                onChange={(e) => setKChat(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">k_label</label>
              <Input
                type="number"
                min={0}
                max={50}
                value={kLabel}
                onChange={(e) => setKLabel(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Etiqueta override</label>
              <select
                value={labelOverride}
                onChange={(e) => setLabelOverride(e.target.value)}
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100"
              >
                <option value="">(del chat)</option>
                {labels.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            Chat ({chatId || "(ninguno — solo etiqueta)"})
          </label>
          <Input
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            placeholder="Buscar chat por nombre o id…"
            className="mb-2"
          />
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <button
              onClick={() => setChatId("")}
              className={cn(
                "w-full rounded px-2 py-1 text-left text-xs",
                !chatId ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50"
              )}
            >
              (ninguno) — usar solo la etiqueta
            </button>
            {filteredChats.map((c) => (
              <button
                key={c.id}
                onClick={() => setChatId(c.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs",
                  chatId === c.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50"
                )}
              >
                <span className="truncate">
                  {c.name ?? "(sin nombre)"}{" "}
                  <span className="font-mono text-[10px] text-zinc-600">{c.id.slice(0, 18)}…</span>
                </span>
                {c.label ? <Badge tone="blue">{c.label}</Badge> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={!query.trim() || (!chatId && !labelOverride) || retrieve.isPending}
            onClick={() =>
              retrieve.mutate({
                query,
                chat_id: chatId || undefined,
                label: labelOverride || undefined,
                k_chat: kChat,
                k_label: kLabel,
              })
            }
          >
            {retrieve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Buscar
          </Button>
        </div>

        {!result ? (
          <EmptyState>Escribe una query y selecciona un chat o etiqueta para ver qué context recuperaría el agente.</EmptyState>
        ) : matches.length === 0 ? (
          <EmptyState>0 matches — quizá el chat aún no tiene embeddings o el filtro es muy estrecho.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {matches.map((m, i) => (
              <MatchRow key={`${m.message_id}-${i}`} match={m} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function MatchRow({ match: m }: { match: { message_id: string; chat_id: string; label: string | null; content: string; from_me: boolean; ts: string; distance: number; similarity: number } }) {
  const simPct = Math.round(m.similarity * 100);
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <Badge tone={m.from_me ? "green" : "default"}>{m.from_me ? "tú" : "otro"}</Badge>
        {m.label ? <Badge tone="blue">{m.label}</Badge> : null}
        <span className="font-mono text-[10px]">{m.chat_id}</span>
        <span className="ml-auto">{new Date(m.ts).toLocaleString()}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-zinc-100">{m.content}</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={cn(
              "h-full",
              simPct > 75 ? "bg-emerald-500" : simPct > 50 ? "bg-amber-500" : "bg-zinc-600"
            )}
            style={{ width: `${simPct}%` }}
          />
        </div>
        <span className="text-xs text-zinc-500 tabular-nums">
          sim {simPct}% · d={m.distance.toFixed(3)}
        </span>
      </div>
    </li>
  );
}
