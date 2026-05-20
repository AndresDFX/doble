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
        <div className="flex gap-1">
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

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-zinc-200">
            {draft.chat_name ?? "(sin nombre)"}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="font-mono">{draft.chat_id}</span>
            {draft.chat_label ? <Badge tone="blue">{draft.chat_label}</Badge> : null}
            <span>{new Date(draft.created_at).toLocaleString()}</span>
          </div>
        </div>
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
      </div>

      {editing ? (
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
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => { onSave(content); setEditing(false); }}>
                <Check className="h-3.5 w-3.5" /> Guardar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setContent(draft.content); setEditing(false); }}>
                <X className="h-3.5 w-3.5" /> Cancelar
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
