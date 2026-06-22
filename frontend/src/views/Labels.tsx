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
    mutationFn: (input: {
      label: string;
      body: { prompt_template?: string; temperature?: number; max_distance?: number };
    }) => api.labels.patch(input.label, input.body),
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
      <GlobalPromptCard />

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

function GlobalPromptCard() {
  const qc = useQueryClient();
  const stateQ = useQuery({ queryKey: ["state"], queryFn: api.state.get });
  const [draft, setDraft] = useState<string | null>(null);
  const current = stateQ.data?.global_prompt ?? "";
  const value = draft ?? current;
  const dirty = draft !== null && draft !== current;

  const save = useMutation({
    mutationFn: (global_prompt: string) => api.state.patch({ global_prompt }),
    onSuccess: (next) => {
      qc.setQueryData(["state"], next);
      setDraft(null);
      toast.success("Prompt general guardado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt general</CardTitle>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(value)}
        >
          <Save className="h-3.5 w-3.5" /> Guardar
        </Button>
      </CardHeader>
      <CardBody className="space-y-2">
        <p className="text-xs text-zinc-500">
          Instrucción que se aplica a <strong>todas</strong> las respuestas, encima de la plantilla
          de cada etiqueta. Útil para reglas transversales de tono o datos fijos (ej.: "nunca uses
          emojis con desconocidos", "firma como J cuando sea trabajo"). Vacío = sin efecto.
        </p>
        <Textarea
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="Ej: Responde siempre en español. Nunca prometas fechas sin confirmarlas."
        />
      </CardBody>
    </Card>
  );
}

function NewLabelForm({
  onCreate,
  onCancel,
}: {
  onCreate: (v: {
    label: string;
    prompt_template: string;
    temperature: number;
    max_distance: number;
    examples: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [tpl, setTpl] = useState("Eres {user_name}. ");
  const [temp, setTemp] = useState(0.7);
  const [maxDist, setMaxDist] = useState(1.3);
  const [ex, setEx] = useState("");
  return (
    <div className="space-y-2">
      <Input
        placeholder="nombre (ej: clientes)"
        value={label}
        onChange={(e) => setLabel(e.target.value.toLowerCase())}
      />
      <Textarea
        value={tpl}
        onChange={(e) => setTpl(e.target.value)}
        rows={4}
        placeholder="Persona + límites (ej: Eres {user_name}. … LÍMITES: no inventes …)"
      />
      <Textarea
        value={ex}
        onChange={(e) => setEx(e.target.value)}
        rows={3}
        placeholder={'Ejemplos de tu estilo (opcional)\nContacto: "..." -> "..."'}
      />
      <div className="flex flex-wrap items-center gap-4">
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
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          max_distance
          <Input
            type="number"
            step="0.1"
            min={0}
            max={2}
            value={maxDist}
            onChange={(e) => setMaxDist(parseFloat(e.target.value))}
            className="h-7 w-20 text-xs"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!label || !tpl}
          onClick={() =>
            onCreate({
              label,
              prompt_template: tpl,
              temperature: temp,
              max_distance: maxDist,
              examples: ex.trim() || null,
            })
          }
        >
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
  onSave: (body: {
    prompt_template?: string;
    temperature?: number;
    max_distance?: number;
    examples?: string | null;
  }) => void;
  onDelete: () => void;
}) {
  const [tpl, setTpl] = useState(label.prompt_template);
  const [temp, setTemp] = useState(label.temperature);
  const [maxDist, setMaxDist] = useState(label.max_distance);
  const [ex, setEx] = useState(label.examples ?? "");
  const dirty =
    tpl !== label.prompt_template ||
    temp !== label.temperature ||
    maxDist !== label.max_distance ||
    (ex.trim() || null) !== (label.examples ?? null);

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
        <label className="block text-xs text-zinc-500">
          Ejemplos de estilo (few-shot, opcional)
          <Textarea
            value={ex}
            onChange={(e) => setEx(e.target.value)}
            rows={3}
            className="mt-1"
            placeholder={'Contacto: "..." -> "..."'}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-4">
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
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              max_distance
              <Input
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={maxDist}
                onChange={(e) => setMaxDist(parseFloat(e.target.value))}
                className="h-7 w-20 text-xs"
              />
            </label>
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            onClick={() =>
              onSave({
                prompt_template: tpl,
                temperature: temp,
                max_distance: maxDist,
                examples: ex.trim() || null,
              })
            }
          >
            <Save className="h-3.5 w-3.5" /> Guardar
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
