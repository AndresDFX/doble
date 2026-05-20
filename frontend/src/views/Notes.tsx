import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type OwnerNote } from "../lib/api";
import { useRecorder } from "../lib/useRecorder";
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
import {
  Check,
  Loader2,
  Mic,
  Pencil,
  Save,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";

export function Notes() {
  const qc = useQueryClient();
  const notesQ = useQuery({ queryKey: ["owner-notes"], queryFn: api.ownerNotes.list });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Capture
        onSaved={() => qc.invalidateQueries({ queryKey: ["owner-notes"] })}
      />
      <NotesList
        notes={notesQ.data ?? []}
        loading={notesQ.isLoading}
        onChanged={() => qc.invalidateQueries({ queryKey: ["owner-notes"] })}
      />
    </div>
  );
}

function Capture({ onSaved }: { onSaved: () => void }) {
  const rec = useRecorder();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [transcript, setTranscript] = useState("");
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const transcribe = useMutation({
    mutationFn: async ({ blob, filename }: { blob: Blob; filename: string }) =>
      api.ownerNotes.transcribe(blob, filename),
    onSuccess: (res) => {
      setTranscript(res.text);
      setMediaPath(res.raw_media_path);
      toast.success("Audio transcrito");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const save = useMutation({
    mutationFn: () =>
      api.ownerNotes.create({ content: transcript, raw_media_path: mediaPath }),
    onSuccess: () => {
      toast.success("Nota guardada y embedded");
      setTranscript("");
      setMediaPath(null);
      setPreviewUrl(null);
      rec.reset();
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    if (rec.blob && rec.url && !transcribe.isPending && !transcript) {
      setPreviewUrl(rec.url);
      transcribe.mutate({
        blob: rec.blob,
        filename: `record-${Date.now()}.${rec.mimeType?.includes("mp4") ? "mp4" : "webm"}`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.blob, rec.url]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    transcribe.mutate({ blob: file, filename: file.name });
  };

  const discard = () => {
    rec.reset();
    setTranscript("");
    setMediaPath(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const busy = transcribe.isPending || save.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capturar nota</CardTitle>
        <span className="text-xs text-zinc-500">graba o sube audio</span>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Recording controls */}
        <div className="flex flex-wrap items-center gap-2">
          {rec.state === "recording" ? (
            <>
              <Button variant="danger" onClick={rec.stop}>
                <Square className="h-3.5 w-3.5" /> Detener
              </Button>
              <span className="font-mono text-sm text-red-300">
                ● {rec.duration.toFixed(1)}s
              </span>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={rec.start}
              disabled={busy}
            >
              <Mic className="h-3.5 w-3.5" /> Grabar
            </Button>
          )}

          <span className="mx-1 text-xs text-zinc-600">o</span>

          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="h-3.5 w-3.5" /> Subir audio
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/webm,video/mp4"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />

          {(previewUrl || transcript) && rec.state !== "recording" ? (
            <Button variant="ghost" size="sm" onClick={discard}>
              <X className="h-3.5 w-3.5" /> Descartar
            </Button>
          ) : null}
        </div>

        {rec.error ? (
          <p className="text-xs text-red-400">Error grabando: {rec.error}</p>
        ) : null}

        {/* Preview player */}
        {previewUrl ? (
          <audio src={previewUrl} controls className="w-full" />
        ) : null}

        {/* Transcript editor */}
        {transcribe.isPending ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Transcribiendo con Gemini…
          </div>
        ) : transcript || previewUrl ? (
          <>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Transcripción (puedes editarla antes de guardar)
              </label>
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={6}
                placeholder="Aquí aparecerá la transcripción…"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">
                {transcript.length} caracteres
              </span>
              <Button
                variant="primary"
                disabled={!transcript.trim() || busy}
                onClick={() => save.mutate()}
              >
                {save.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Guardar nota
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-zinc-500">
            Las notas grabadas o subidas se transcriben con Gemini, se guardan en
            la base y se indexan en el RAG. El agente las usará como contexto de
            fondo en TODAS las conversaciones.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function NotesList({
  notes,
  loading,
  onChanged,
}: {
  notes: OwnerNote[];
  loading: boolean;
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notas guardadas ({notes.length})</CardTitle>
      </CardHeader>
      <CardBody className="max-h-[80vh] space-y-2 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : notes.length === 0 ? (
          <EmptyState>
            Aún no has guardado notas. Graba o sube un audio del lado izquierdo.
          </EmptyState>
        ) : (
          notes.map((n) => <NoteRow key={n.id} note={n} onChanged={onChanged} />)
        )}
      </CardBody>
    </Card>
  );
}

function NoteRow({ note, onChanged }: { note: OwnerNote; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(note.content);

  const update = useMutation({
    mutationFn: (text: string) => api.ownerNotes.update(note.id, { content: text }),
    onSuccess: () => {
      toast.success("Nota actualizada");
      setEditing(false);
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => api.ownerNotes.remove(note.id),
    onSuccess: () => {
      toast.success("Nota eliminada");
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <Badge tone={note.embedded ? "green" : "amber"}>
          {note.embedded ? "embedded" : "sin embed"}
        </Badge>
        <span>{new Date(note.ts).toLocaleString()}</span>
        <span className="ml-auto font-mono text-[10px]">{note.id.slice(0, 8)}</span>
      </div>

      {editing ? (
        <>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="mb-2"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!content.trim() || update.isPending}
              onClick={() => update.mutate(content)}
            >
              <Check className="h-3.5 w-3.5" /> Guardar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setContent(note.content);
                setEditing(false);
              }}
            >
              <X className="h-3.5 w-3.5" /> Cancelar
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm text-zinc-100">{note.content}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm("¿Eliminar esta nota?")) remove.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
