import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Chat, type ChatPatchBody, type Message } from "../lib/api";
import {
  Badge,
  Button,
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
import { Pencil, Check, X, Power, PowerOff } from "lucide-react";

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
    mutationFn: (input: { id: string; body: ChatPatchBody }) =>
      api.chats.patch(input.id, input.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      toast.success("Chat actualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkAgent = useMutation({
    mutationFn: (agent_enabled: boolean) =>
      api.chats.bulkAgent({ q: q || undefined, label: labelFilter || undefined, agent_enabled }),
    onSuccess: ({ updated }, agent_enabled) => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      toast.success(`Agente ${agent_enabled ? "activado" : "desactivado"} en ${updated} chat(s)`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const loaded = chatsQ.data?.length ?? 0;
  const filtered = Boolean(q || labelFilter);
  const runBulk = (enabled: boolean) => {
    const scope = filtered ? `los ${loaded}+ chats del filtro actual` : `TODOS los chats (${loaded}+)`;
    if (confirm(`¿${enabled ? "Activar" : "Desactivar"} el agente para ${scope}?`)) {
      bulkAgent.mutate(enabled);
    }
  };

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
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <span className="text-[11px] text-zinc-500">
            Acciones masivas {filtered ? "(filtro actual)" : "(todos los chats)"}:
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkAgent.isPending || loaded === 0}
            onClick={() => runBulk(true)}
            title="Activar el agente para los chats que coinciden con la búsqueda/etiqueta de arriba"
          >
            <Power className="h-3.5 w-3.5" /> Activar agente
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkAgent.isPending || loaded === 0}
            onClick={() => runBulk(false)}
            title="Desactivar el agente para los chats que coinciden con la búsqueda/etiqueta de arriba"
          >
            <PowerOff className="h-3.5 w-3.5" /> Desactivar agente
          </Button>
        </div>
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
  onPatch: (body: ChatPatchBody) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(chat.name ?? "");

  const saveName = () => {
    onPatch({ name: nameDraft.trim() || null });
    setEditingName(false);
  };
  const cancelName = () => {
    setNameDraft(chat.name ?? "");
    setEditingName(false);
  };

  // Phone: prefer the persisted value, else derive from an @s.whatsapp.net JID.
  const phone =
    chat.phone ??
    (chat.id.endsWith("@s.whatsapp.net") ? chat.id.split("@")[0]?.split(":")[0] ?? null : null);
  const isGroup = chat.id.endsWith("@g.us");
  const isLid = chat.id.endsWith("@lid");

  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 hover:bg-zinc-800/40",
        selected && "bg-zinc-800/30"
      )}
    >
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        {editingName ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") cancelName();
              }}
              autoFocus
              placeholder="Nombre del contacto"
              className="h-7 text-sm"
            />
            <Button variant="primary" size="sm" onClick={saveName} title="Guardar">
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelName} title="Cancelar">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-zinc-100">
              {chat.name ?? "(sin nombre)"}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setNameDraft(chat.name ?? "");
                setEditingName(true);
              }}
              className="shrink-0 text-zinc-500 hover:text-zinc-200"
              title="Editar nombre"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-zinc-500">
          {phone ? (
            <span className="font-mono text-zinc-400">+{phone}</span>
          ) : isGroup ? (
            <span>grupo</span>
          ) : isLid ? (
            <span className="text-amber-500/80">sin número</span>
          ) : null}
          <span className="truncate font-mono">{chat.id}</span>
        </div>
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
        <div className="flex items-center gap-1.5" title="Agente activo en este chat">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Agente</span>
          <Switch checked={chat.agent_enabled} onChange={(v) => onPatch({ agent_enabled: v })} />
        </div>
        <ProactiveControls chat={chat} onPatch={onPatch} />
      </div>
    </div>
  );
}

/**
 * Per-chat proactive messaging: a switch to opt this chat in, plus the random
 * interval range (minutes) shown only when on. Saves the range on blur/Enter,
 * clamping and ordering min/max locally for instant feedback.
 */
function ProactiveControls({
  chat,
  onPatch,
}: {
  chat: Chat;
  onPatch: (body: ChatPatchBody) => void;
}) {
  const [min, setMin] = useState(String(chat.proactive_min_minutes));
  const [max, setMax] = useState(String(chat.proactive_max_minutes));

  // Re-sync local inputs if the server value changes (e.g. clamped on save).
  useEffect(() => setMin(String(chat.proactive_min_minutes)), [chat.proactive_min_minutes]);
  useEffect(() => setMax(String(chat.proactive_max_minutes)), [chat.proactive_max_minutes]);

  const clamp = (v: string, fallback: number) =>
    Math.max(1, Math.min(1440, Math.round(Number(v) || fallback)));

  const saveRange = () => {
    const lo = clamp(min, 1);
    const hi = clamp(max, 60);
    const orderedLo = Math.min(lo, hi);
    const orderedHi = Math.max(lo, hi);
    setMin(String(orderedLo));
    setMax(String(orderedHi));
    if (
      orderedLo !== chat.proactive_min_minutes ||
      orderedHi !== chat.proactive_max_minutes
    ) {
      onPatch({ proactive_min_minutes: orderedLo, proactive_max_minutes: orderedHi });
    }
  };

  const nextHint =
    chat.proactive_enabled && chat.proactive_next_ts
      ? `próx. ${new Date(chat.proactive_next_ts).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : null;

  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      title="Mensajes proactivos: el agente escribe solo cada cierto tiempo aleatorio"
    >
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">Proactivo</span>
      <Switch
        checked={chat.proactive_enabled}
        onChange={(v) => onPatch({ proactive_enabled: v })}
      />
      {chat.proactive_enabled && (
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <Input
            type="number"
            min={1}
            max={1440}
            value={min}
            onChange={(e) => setMin(e.target.value)}
            onBlur={saveRange}
            onKeyDown={(e) => e.key === "Enter" && saveRange()}
            className="h-7 w-12 px-1.5 text-center text-xs"
            title="mínimo (min)"
          />
          <span>–</span>
          <Input
            type="number"
            min={1}
            max={1440}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            onBlur={saveRange}
            onKeyDown={(e) => e.key === "Enter" && saveRange()}
            className="h-7 w-12 px-1.5 text-center text-xs"
            title="máximo (min)"
          />
          <span>min</span>
          {nextHint && <span className="ml-1 text-zinc-600">· {nextHint}</span>}
        </div>
      )}
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
