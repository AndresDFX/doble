import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AgentState } from "../lib/api";
import { Button, Card, CardBody, CardHeader, CardTitle, Switch, StatusDot, Badge, Input } from "../components/ui";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function Dashboard() {
  const qc = useQueryClient();
  const healthQ = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const waQ = useQuery({
    queryKey: ["wa"],
    queryFn: api.wa.status,
    // While not connected, poll so a freshly generated QR shows up even if an
    // SSE event is missed.
    refetchInterval: (q) => (q.state.data?.connection === "open" ? false : 4000),
  });
  const stateQ = useQuery({ queryKey: ["state"], queryFn: api.state.get });

  const patchState = useMutation({
    mutationFn: (body: Partial<AgentState>) => api.state.patch(body),
    onSuccess: (next) => {
      qc.setQueryData(["state"], next);
      toast.success("Estado actualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const relink = useMutation({
    mutationFn: api.wa.relink,
    onSuccess: () => toast.success("Revinculando… escanea el QR cuando aparezca"),
    onError: (err: Error) => toast.error(err.message),
  });

  const state = stateQ.data;
  const wa = waQ.data;
  const health = healthQ.data;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Salud del sistema</CardTitle>
          <span className="text-xs text-zinc-500">
            {health?.at ? new Date(health.at).toLocaleTimeString() : ""}
          </span>
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <HealthPill label="Gateway" status={health?.gateway === "ok" ? "ok" : "down"} />
          <HealthPill label="Postgres" status={health?.db ?? "down"} />
          <HealthPill label="AI service" status={health?.ai ?? "down"} />
          <HealthPill label="WhatsApp" status={health?.wa ?? "close"} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conexión WhatsApp</CardTitle>
          <Badge tone={wa?.connection === "open" ? "green" : wa?.connection === "connecting" ? "amber" : "red"}>
            {wa?.connection ?? "?"}
          </Badge>
        </CardHeader>
        <CardBody>
          {wa?.connection === "open" ? (
            <div className="text-sm text-zinc-300">
              <div className="font-medium">{wa.me.name ?? "—"}</div>
              <div className="font-mono text-xs text-zinc-500">{wa.me.id}</div>
            </div>
          ) : wa?.qrDataUrl ? (
            <div className="flex flex-col items-center gap-2">
              <img src={wa.qrDataUrl} className="h-auto w-full max-w-[220px] rounded-lg" alt="Escanear QR" />
              <p className="text-xs text-zinc-400">
                WhatsApp → Dispositivos vinculados → Vincular un dispositivo
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Esperando estado…
            </div>
          )}
          {wa?.lastError ? (
            <p className="mt-3 text-xs text-red-400">Último error: {wa.lastError}</p>
          ) : null}
          <div className="mt-4 flex justify-center border-t border-zinc-800 pt-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={relink.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Esto cierra la sesión actual de WhatsApp y pide escanear un QR nuevo. ¿Continuar?"
                  )
                ) {
                  relink.mutate();
                }
              }}
            >
              {relink.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Revincular dispositivo
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Estado del agente</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Activo globalmente</span>
            <Switch
              checked={!!state?.enabled}
              disabled={!state || patchState.isPending}
              onChange={(v) => patchState.mutate({ enabled: v })}
              label={state?.enabled ? "Encendido" : "Apagado"}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Modo borrador (no envía solo)</span>
            <Switch
              checked={!!state?.draft_mode}
              disabled={!state || patchState.isPending}
              onChange={(v) => patchState.mutate({ draft_mode: v })}
              label={state?.draft_mode ? "Solo borradores" : "Auto-responde"}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Cómo se refiere a ti</span>
            <Input
              defaultValue={state?.user_name ?? ""}
              onBlur={(e) => {
                if (e.target.value && e.target.value !== state?.user_name) {
                  patchState.mutate({ user_name: e.target.value });
                }
              }}
              placeholder="Julian"
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function HealthPill({ label, status }: { label: string; status: "ok" | "down" | "open" | "close" | "connecting" }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <span className="text-sm text-zinc-300">{label}</span>
      <span className="flex items-center gap-1.5 text-xs text-zinc-400">
        <StatusDot status={status} />
        {status}
      </span>
    </div>
  );
}
