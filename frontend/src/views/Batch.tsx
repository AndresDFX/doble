import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CatalogTheme, type SenderStatus, type BatchState } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  StatusDot,
} from "../components/ui";
import { cn } from "../lib/cn";
import { toast } from "sonner";
import {
  Eraser,
  Loader2,
  PlugZap,
  Play,
  Power,
  Send,
  StopCircle,
} from "lucide-react";

export function Batch() {
  const qc = useQueryClient();

  const statusQ = useQuery({
    queryKey: ["sender-status"],
    queryFn: api.sender.status,
    refetchInterval: 5_000,
  });
  const catalogQ = useQuery({ queryKey: ["sender-catalog"], queryFn: api.sender.catalog });
  const batchQ = useQuery({
    queryKey: ["batch-state"],
    queryFn: api.sender.batchState,
    refetchInterval: 3_000,
  });

  const connect = useMutation({
    mutationFn: api.sender.connect,
    onSuccess: (data) => qc.setQueryData(["sender-status"], data),
    onError: (err: Error) => toast.error(err.message),
  });
  const disconnect = useMutation({
    mutationFn: api.sender.disconnect,
    onSuccess: (data) => qc.setQueryData(["sender-status"], data),
  });
  const purge = useMutation({
    mutationFn: api.sender.purge,
    onSuccess: (data) => {
      qc.setQueryData(["sender-status"], data);
      toast.success("Sesión borrada — vuelve a conectar para escanear QR fresco");
    },
  });
  const abort = useMutation({
    mutationFn: api.sender.abortBatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch-state"] });
      toast.warning("Batch abortado");
    },
  });

  const status = statusQ.data;
  const batch = batchQ.data;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <SenderCard
        status={status}
        onConnect={() => connect.mutate()}
        onDisconnect={() => disconnect.mutate()}
        onPurge={() => {
          if (confirm("¿Borrar la sesión del sender? Tendrás que escanear QR de nuevo.")) {
            purge.mutate();
          }
        }}
        connecting={connect.isPending}
      />

      <BatchForm
        catalog={catalogQ.data ?? []}
        senderReady={status?.connection === "open"}
        batchRunning={batch?.status === "running"}
      />

      <BatchProgress
        batch={batch}
        onAbort={() => abort.mutate()}
      />
    </div>
  );
}

function SenderCard({
  status,
  onConnect,
  onDisconnect,
  onPurge,
  connecting,
}: {
  status: SenderStatus | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  onPurge: () => void;
  connecting: boolean;
}) {
  const c = status?.connection ?? "idle";
  const tone = c === "open" ? "green" : c === "connecting" ? "amber" : c === "close" ? "red" : "default";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sender (WhatsApp A)</CardTitle>
        <Badge tone={tone}>
          <StatusDot status={c === "idle" ? "close" : c} /> {c}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        {c === "open" && status?.me ? (
          <div className="text-sm">
            <div className="font-medium text-zinc-200">{status.me.name ?? "—"}</div>
            <div className="font-mono text-xs text-zinc-500">{status.me.id}</div>
          </div>
        ) : c === "connecting" && status?.qrDataUrl ? (
          <div className="flex flex-col items-center gap-2">
            <img src={status.qrDataUrl} className="rounded-lg" alt="QR del sender" />
            <p className="text-center text-xs text-zinc-400">
              Escanéa con tu <strong>WhatsApp principal</strong> → Dispositivos vinculados
            </p>
          </div>
        ) : c === "connecting" ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Conectando…
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            El sender no está conectado. Úsalo para mandar lotes de prueba desde tu número A
            hacia el agente en B.
          </p>
        )}

        {status?.lastError ? (
          <p className="text-xs text-red-400">{status.lastError}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {c !== "open" ? (
            <Button variant="primary" size="sm" onClick={onConnect} disabled={connecting}>
              <PlugZap className="h-3.5 w-3.5" /> Conectar
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onDisconnect}>
              <Power className="h-3.5 w-3.5" /> Desconectar
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onPurge}>
            <Eraser className="h-3.5 w-3.5" /> Borrar sesión
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function BatchForm({
  catalog,
  senderReady,
  batchRunning,
}: {
  catalog: CatalogTheme[];
  senderReady: boolean;
  batchRunning: boolean;
}) {
  const [to, setTo] = useState("");
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(new Set());
  const [count, setCount] = useState<number | "">("");
  const [minDelay, setMinDelay] = useState(6000);
  const [maxDelay, setMaxDelay] = useState(15000);
  const [dry, setDry] = useState(false);

  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: api.sender.startBatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch-state"] });
      toast.success(dry ? "Plan generado (DRY)" : "Batch encolado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const totalPlanned = useMemo(() => {
    const themes = selectedThemes.size === 0 ? catalog.map((c) => c.theme) : [...selectedThemes];
    return themes.reduce((sum, t) => {
      const c = catalog.find((x) => x.theme === t);
      if (!c) return sum;
      return sum + (count ? Math.min(count, c.count) : c.count);
    }, 0);
  }, [catalog, selectedThemes, count]);

  const toggleTheme = (theme: string) => {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Disparar lote</CardTitle>
        <Badge tone="blue">{totalPlanned} mensajes plan</Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">
              Destino (WhatsApp B: número o JID)
            </label>
            <Input
              placeholder="573243198985"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Máx/tema</label>
              <Input
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value ? Number(e.target.value) : "")}
                placeholder="todos"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Min delay ms</label>
              <Input
                type="number"
                min={500}
                value={minDelay}
                onChange={(e) => setMinDelay(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Max delay ms</label>
              <Input
                type="number"
                min={500}
                value={maxDelay}
                onChange={(e) => setMaxDelay(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs text-zinc-400">
            Temas {selectedThemes.size === 0 ? "(ninguno = todos)" : `(${selectedThemes.size})`}
          </p>
          {catalog.length === 0 ? (
            <EmptyState>Catálogo vacío. Edita gateway/sender/messages.json.</EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {catalog.map((c) => {
                const active = selectedThemes.has(c.theme);
                return (
                  <button
                    key={c.theme}
                    onClick={() => toggleTheme(c.theme)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "border-emerald-500/50 bg-emerald-500/10 text-zinc-100"
                        : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{c.theme}</span>
                      <span className="text-xs text-zinc-500">{c.count}</span>
                    </div>
                    <div className="mt-1 truncate text-[10px] text-zinc-500">
                      {c.samples[0]}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={dry}
              onChange={(e) => setDry(e.target.checked)}
            />
            Vista previa (no enviar)
          </label>
          <Button
            variant="primary"
            disabled={!to || !senderReady || batchRunning || start.isPending}
            onClick={() =>
              start.mutate({
                to,
                themes: selectedThemes.size > 0 ? [...selectedThemes] : undefined,
                count: count || undefined,
                minDelayMs: minDelay,
                maxDelayMs: maxDelay,
                dry,
              })
            }
          >
            {dry ? <Play className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {dry ? "Previsualizar" : "Enviar"}
          </Button>
        </div>

        {!senderReady ? (
          <p className="text-xs text-amber-400">
            El sender no está conectado. Usa el card de la izquierda para conectarlo primero.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function BatchProgress({
  batch,
  onAbort,
}: {
  batch: BatchState | undefined;
  onAbort: () => void;
}) {
  if (!batch || batch.status === "idle" || !batch.id) {
    return (
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Progreso</CardTitle>
        </CardHeader>
        <CardBody>
          <EmptyState>Sin batch activo. Arranca uno arriba.</EmptyState>
        </CardBody>
      </Card>
    );
  }

  const pct = batch.total > 0 ? Math.round(((batch.sent + batch.failed) / batch.total) * 100) : 0;
  const running = batch.status === "running";

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>
          Batch {batch.id.slice(0, 8)}
          <span className="ml-2 text-xs text-zinc-500">— {batch.status}</span>
        </CardTitle>
        {running ? (
          <Button variant="danger" size="sm" onClick={onAbort}>
            <StopCircle className="h-3.5 w-3.5" /> Abortar
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-emerald-300">Enviados: {batch.sent}</span>
          <span className="text-red-300">Fallos: {batch.failed}</span>
          <span className="text-zinc-400">Total: {batch.total}</span>
          <span className="ml-auto text-xs text-zinc-500">
            {batch.startedAt ? new Date(batch.startedAt).toLocaleTimeString() : ""}
            {batch.finishedAt ? ` → ${new Date(batch.finishedAt).toLocaleTimeString()}` : ""}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={cn(
              "h-full transition-all",
              batch.status === "failed" ? "bg-red-500" : "bg-emerald-500"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-zinc-500">
          Sigue el detalle por mensaje en la pestaña <strong>Actividad</strong> (filtro
          <em> Batch</em>).
        </p>
      </CardBody>
    </Card>
  );
}
