import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Draft } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Textarea,
} from "../components/ui";
import { toast } from "sonner";
import { Send, Trash2, Pencil, Check, X } from "lucide-react";

const STATUSES = ["pending", "approved", "sent", "discarded"] as const;
type Status = (typeof STATUSES)[number];

export function Drafts() {
  const [status, setStatus] = useState<Status>("pending");
  const qc = useQueryClient();
  const draftsQ = useQuery({
    queryKey: ["drafts", status],
    queryFn: () => api.drafts.list(status),
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => api.drafts.send(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      toast.success("Enviado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const discardMutation = useMutation({
    mutationFn: (id: number) => api.drafts.discard(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      toast.success("Descartado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const patchMutation = useMutation({
    mutationFn: (input: { id: number; content: string }) =>
      api.drafts.patch(input.id, { content: input.content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      toast.success("Borrador editado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Borradores</CardTitle>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-md px-2 py-1 text-xs ${
                status === s
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {draftsQ.data?.length ? (
          draftsQ.data.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              onSend={() => sendMutation.mutate(d.id)}
              onDiscard={() => discardMutation.mutate(d.id)}
              onSave={(content) => patchMutation.mutate({ id: d.id, content })}
              busy={sendMutation.isPending || discardMutation.isPending || patchMutation.isPending}
            />
          ))
        ) : (
          <EmptyState>No hay borradores con estado "{status}".</EmptyState>
        )}
      </CardBody>
    </Card>
  );
}

function DraftCard({
  draft,
  onSend,
  onDiscard,
  onSave,
  busy,
}: {
  draft: Draft;
  onSend: () => void;
  onDiscard: () => void;
  onSave: (content: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(draft.content);

  // Show the abstention treatment only while unresolved; once sent it reads as a normal draft.
  const isNeedsInfo = draft.kind === "needs_info";
  const showNeedsInfo = isNeedsInfo && draft.status === "pending";
  // A needs_info draft has no canned reply yet — the owner must write one before sending.
  const hasReply = draft.content.trim().length > 0;

  return (
    <div
      className={`rounded-lg border p-3 ${
        showNeedsInfo
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-zinc-800 bg-zinc-950/30"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-zinc-200">
            {draft.chat_name ?? "(sin nombre)"}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="break-all font-mono">{draft.chat_id}</span>
            {draft.chat_label ? <Badge tone="blue">{draft.chat_label}</Badge> : null}
            <span>{new Date(draft.created_at).toLocaleString()}</span>
          </div>
        </div>
        {showNeedsInfo ? (
          <Badge tone="amber">falta contexto</Badge>
        ) : (
          <Badge
            tone={
              draft.status === "pending"
                ? "amber"
                : draft.status === "sent"
                  ? "green"
                  : draft.status === "discarded"
                    ? "red"
                    : "default"
            }
          >
            {draft.status}
          </Badge>
        )}
      </div>

      {showNeedsInfo && !editing ? (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm">
          <div className="mb-1 font-medium text-amber-300">
            El agente no supo responder — falta contexto
          </div>
          <p className="text-zinc-200">
            {draft.missing ?? "Información insuficiente para responder con certeza."}
          </p>
          {hasReply ? (
            <p className="mt-2 whitespace-pre-wrap text-zinc-100">{draft.content}</p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">
              Responde tú, o agrega el dato en Notas y vuelve a recibir el mensaje.
            </p>
          )}
        </div>
      ) : editing ? (
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          className="mb-2"
        />
      ) : (
        <p className="mb-2 whitespace-pre-wrap text-sm text-zinc-100">{draft.content}</p>
      )}

      {draft.status === "pending" || draft.status === "approved" ? (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => { onSave(content); setEditing(false); }}>
                <Check className="h-3.5 w-3.5" /> Guardar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setContent(draft.content); setEditing(false); }}>
                <X className="h-3.5 w-3.5" /> Cancelar
              </Button>
            </>
          ) : showNeedsInfo && !hasReply ? (
            <>
              <Button variant="primary" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Responder yo
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={onDiscard}>
                <Trash2 className="h-3.5 w-3.5" /> Descartar
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="sm" disabled={busy} onClick={onSend}>
                <Send className="h-3.5 w-3.5" /> Enviar
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Editar
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={onDiscard}>
                <Trash2 className="h-3.5 w-3.5" /> Descartar
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
