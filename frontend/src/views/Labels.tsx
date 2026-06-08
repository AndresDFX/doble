import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Label } from "../lib/api";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Textarea } from "../components/ui";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";

export function Labels() {
  const qc = useQueryClient();
  const labelsQ = useQuery({ queryKey: ["labels"], queryFn: api.labels.list });
  const [creating, setCreating] = useState(false);

  const upsert = useMutation({
    mutationFn: api.labels.upsert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels"] });
      toast.success("Etiqueta guardada");
      setCreating(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const patch = useMutation({
    mutationFn: (input: { label: string; body: { prompt_template?: string; temperature?: number } }) =>
      api.labels.patch(input.label, input.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels"] });
      toast.success("Etiqueta actualizada");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: api.labels.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels"] });
      toast.success("Etiqueta eliminada");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Etiquetas y prompts</CardTitle>
          <Button size="sm" variant="primary" onClick={() => setCreating(!creating)}>
            <Plus className="h-3.5 w-3.5" /> Nueva
          </Button>
        </CardHeader>
        {creating ? (
          <CardBody>
            <NewLabelForm onCreate={(v) => upsert.mutate(v)} onCancel={() => setCreating(false)} />
          </CardBody>
        ) : null}
      </Card>

      {labelsQ.data?.map((l) => (
        <LabelEditor
          key={l.label}
          label={l}
          onSave={(body) => patch.mutate({ label: l.label, body })}
          onDelete={() => {
            if (confirm(`¿Eliminar etiqueta "${l.label}"?`)) remove.mutate(l.label);
          }}
        />
      ))}
    </div>
  );
}

function NewLabelForm({
  onCreate,
  onCancel,
}: {
  onCreate: (v: { label: string; prompt_template: string; temperature: number }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [tpl, setTpl] = useState("Eres {user_name}. ");
  const [temp, setTemp] = useState(0.7);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input placeholder="nombre (ej: clientes)" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} />
        <Input
          type="number"
          step="0.1"
          min={0}
          max={2}
          value={temp}
          onChange={(e) => setTemp(parseFloat(e.target.value))}
        />
      </div>
      <Textarea value={tpl} onChange={(e) => setTpl(e.target.value)} rows={4} />
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={!label || !tpl} onClick={() => onCreate({ label, prompt_template: tpl, temperature: temp })}>
          <Save className="h-3.5 w-3.5" /> Crear
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function LabelEditor({
  label,
  onSave,
  onDelete,
}: {
  label: Label;
  onSave: (body: { prompt_template?: string; temperature?: number }) => void;
  onDelete: () => void;
}) {
  const [tpl, setTpl] = useState(label.prompt_template);
  const [temp, setTemp] = useState(label.temperature);
  const dirty = tpl !== label.prompt_template || temp !== label.temperature;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{label.label}</CardTitle>
          <Badge tone="blue">{label.chats} chats</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={onDelete} disabled={label.label === "default"}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardBody className="space-y-2">
        <Textarea value={tpl} onChange={(e) => setTpl(e.target.value)} rows={4} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            temperature
            <Input
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={temp}
              onChange={(e) => setTemp(parseFloat(e.target.value))}
              className="h-7 w-20 text-xs"
            />
          </label>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            onClick={() => onSave({ prompt_template: tpl, temperature: temp })}
          >
            <Save className="h-3.5 w-3.5" /> Guardar
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
