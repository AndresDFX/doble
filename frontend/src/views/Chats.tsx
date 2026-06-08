import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Chat, type Message } from "../lib/api";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Switch,
} from "../components/ui";
import { cn } from "../lib/cn";
import { toast } from "sonner";

export function Chats() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const chatsQ = useQuery({
    queryKey: ["chats", { q, label: labelFilter }],
    queryFn: () => api.chats.list({ q: q || undefined, label: labelFilter || undefined }),
  });
  const labelsQ = useQuery({ queryKey: ["labels"], queryFn: api.labels.list });

  const labelOptions = useMemo(
    () => labelsQ.data?.map((l) => l.label) ?? [],
    [labelsQ.data]
  );

  const patchChat = useMutation({
    mutationFn: (input: { id: string; body: { label?: string | null; agent_enabled?: boolean } }) =>
      api.chats.patch(input.id, input.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      toast.success("Chat actualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Chats ({chatsQ.data?.length ?? 0})</CardTitle>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Input
              placeholder="Buscar por nombre o id"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-full text-xs sm:w-48"
            />
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="h-8 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100"
            >
              <option value="">todas</option>
              {labelOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="max-h-[70vh] overflow-y-auto p-0">
          {chatsQ.data?.length ? (
            <div className="divide-y divide-zinc-800">
              {chatsQ.data.map((c) => (
                <ChatRow
                  key={c.id}
                  chat={c}
                  labels={labelOptions}
                  selected={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                  onPatch={(body) => patchChat.mutate({ id: c.id, body })}
                />
              ))}
            </div>
          ) : (
            <EmptyState>Sin chats que mostrar.</EmptyState>
          )}
        </CardBody>
      </Card>

      <ChatDetail chatId={selectedId} />
    </div>
  );
}

function ChatRow({
  chat,
  labels,
  selected,
  onSelect,
  onPatch,
}: {
  chat: Chat;
  labels: string[];
  selected: boolean;
  onSelect: () => void;
  onPatch: (body: { label?: string | null; agent_enabled?: boolean }) => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 hover:bg-zinc-800/40",
        selected && "bg-zinc-800/30"
      )}
    >
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <div className="truncate font-medium text-zinc-100">{chat.name ?? "(sin nombre)"}</div>
        <div className="truncate font-mono text-[10px] text-zinc-500">{chat.id}</div>
      </div>
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <select
          value={chat.label ?? ""}
          onChange={(e) => onPatch({ label: e.target.value || null })}
          className="h-8 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100"
        >
          <option value="">— etiqueta</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
          {chat.msgs.toLocaleString()} msgs
        </span>
        <Switch checked={chat.agent_enabled} onChange={(v) => onPatch({ agent_enabled: v })} />
      </div>
    </div>
  );
}

function ChatDetail({ chatId }: { chatId: string | null }) {
  const messagesQ = useQuery({
    queryKey: ["messages", chatId],
    queryFn: () => api.chats.messages(chatId!, 50),
    enabled: !!chatId,
    refetchInterval: chatId ? 5_000 : false,
  });

  if (!chatId) {
    return (
      <Card>
        <CardBody>
          <EmptyState>Selecciona un chat para ver sus mensajes recientes.</EmptyState>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Últimos mensajes</CardTitle>
        <Badge tone="blue">{messagesQ.data?.length ?? 0}</Badge>
      </CardHeader>
      <CardBody className="max-h-[70vh] space-y-2 overflow-y-auto">
        {messagesQ.data
          ?.slice()
          .reverse()
          .map((m) => <MessageBubble key={m.id} m={m} />)}
      </CardBody>
    </Card>
  );
}

function MessageBubble({ m }: { m: Message }) {
  return (
    <div className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${
          m.from_me ? "bg-emerald-500/15 text-emerald-100" : "bg-zinc-800 text-zinc-100"
        }`}
      >
        {m.content ?? <em className="text-zinc-500">[{m.type}]</em>}
        <div className="mt-0.5 text-[10px] text-zinc-500">
          {new Date(m.ts).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
