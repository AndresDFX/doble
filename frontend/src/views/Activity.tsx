import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Activity, type ActivityKind } from "../lib/api";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Eraser,
  FileText,
  MessageCircle,
  Send,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

const KIND_META: Record<
  ActivityKind,
  { label: string; icon: typeof Bot; cls: string }
> = {
  wa: { label: "WhatsApp", icon: Smartphone, cls: "text-emerald-300" },
  sender: { label: "Sender", icon: Send, cls: "text-blue-300" },
  "message-in": { label: "Entrada", icon: ArrowDownToLine, cls: "text-zinc-300" },
  "message-out": { label: "Salida", icon: ArrowUpFromLine, cls: "text-amber-300" },
  draft: { label: "Borrador", icon: FileText, cls: "text-violet-300" },
  ai: { label: "IA", icon: Bot, cls: "text-fuchsia-300" },
  batch: { label: "Batch", icon: MessageCircle, cls: "text-cyan-300" },
  system: { label: "Sistema", icon: Bot, cls: "text-zinc-400" },
  error: { label: "Error", icon: TriangleAlert, cls: "text-red-300" },
};

const KIND_FILTERS: { key: ActivityKind | "all"; label: string }[] = [
  { key: "all", label: "Todo" },
  { key: "wa", label: "WA" },
  { key: "sender", label: "Sender" },
  { key: "message-in", label: "Entrantes" },
  { key: "message-out", label: "Salientes" },
  { key: "draft", label: "Drafts" },
  { key: "ai", label: "IA" },
  { key: "batch", label: "Batch" },
  { key: "error", label: "Errores" },
];

export function ActivityView() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ActivityKind | "all">("all");
  const [search, setSearch] = useState("");

  const activityQ = useQuery({
    queryKey: ["activity"],
    queryFn: () => api.activity.list(500),
  });

  const clear = useMutation({
    mutationFn: api.activity.clear,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success("Actividad limpiada");
    },
  });

  const items = activityQ.data ?? [];
  const filtered = useMemo(() => {
    let out = items;
    if (filter !== "all") out = out.filter((a) => a.kind === filter);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(
        (a) =>
          a.message.toLowerCase().includes(q) ||
          JSON.stringify(a.meta ?? {}).toLowerCase().includes(q)
      );
    }
    return out;
  }, [items, filter, search]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: items.length };
    for (const a of items) m[a.kind] = (m[a.kind] ?? 0) + 1;
    return m;
  }, [items]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actividad ({filtered.length})</CardTitle>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar texto…"
            className="h-8 w-48 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100"
          />
          <Button size="sm" variant="ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>
            <Eraser className="h-3.5 w-3.5" /> Limpiar
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        <div className="mb-3 flex flex-wrap gap-1">
          {KIND_FILTERS.map((f) => {
            const isActive = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                  isActive
                    ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                    : "border-zinc-800 bg-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                )}
              >
                {f.label}
                <span className="rounded bg-zinc-900 px-1 text-[10px] text-zinc-500">
                  {counts[f.key === "all" ? "all" : f.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <EmptyState>No hay eventos con ese filtro.</EmptyState>
        ) : (
          <ul className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
            {filtered.map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function ActivityRow({ a }: { a: Activity }) {
  const m = KIND_META[a.kind];
  const Icon = m.icon;
  const levelTone =
    a.level === "success"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : a.level === "warn"
        ? "border-amber-500/30 bg-amber-500/5"
        : a.level === "error"
          ? "border-red-500/30 bg-red-500/5"
          : "border-zinc-800 bg-zinc-900/40";
  return (
    <li className={cn("flex items-start gap-2 rounded-md border px-2.5 py-1.5", levelTone)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", m.cls)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Badge tone="default">{m.label}</Badge>
          <span>{new Date(a.ts).toLocaleTimeString()}</span>
        </div>
        <p className="mt-0.5 break-words text-sm text-zinc-100">{a.message}</p>
        {a.meta && Object.keys(a.meta).length > 0 ? (
          <details className="mt-1 text-xs text-zinc-500">
            <summary className="cursor-pointer">meta</summary>
            <pre className="mt-1 overflow-x-auto rounded bg-zinc-950/60 p-2 text-[10px] text-zinc-400">
              {JSON.stringify(a.meta, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </li>
  );
}
