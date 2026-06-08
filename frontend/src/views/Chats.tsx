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
        <CardBody className="max-h-[70vh] overflow-auto p-0">
          {chatsQ.data?.length ? (
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Chat</th>
                  <th className="px-3 py-2 text-left">Etiqueta</th>
                  <th className="px-3 py-2 text-right">Msgs</th>
                  <th className="px-3 py-2 text-center">Activo</th>
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </table>
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
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-t border-zinc-800 hover:bg-zinc-800/40 ${selected ? "bg-zinc-800/30" : ""}`}
    >
      <td className="px-3 py-2">
        <div className="font-medium text-zinc-100">{chat.name ?? "(sin nombre)"}</div>
        <div className="font-mono text-[10px] text-zinc-500">{chat.id}</div>
      </td>
      <td className="px-3 py-2">
        <select
          value={chat.label ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onPatch({ label: e.target.value || null })}
          className="h-7 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100"
        >
          <option value="">—</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right text-xs text-zinc-400">{chat.msgs}</td>
      <td className="px-3 py-2">
        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={chat.agent_enabled}
            onChange={(v) => onPatch({ agent_enabled: v })}
          />
        </div>
      </td>
    </tr>
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
