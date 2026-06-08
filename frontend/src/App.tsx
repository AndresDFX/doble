import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dashboard } from "./views/Dashboard";
import { Chats } from "./views/Chats";
import { Drafts } from "./views/Drafts";
import { Labels } from "./views/Labels";
import { ActivityView } from "./views/Activity";
import { Batch } from "./views/Batch";
import { Rag } from "./views/Rag";
import { Notes } from "./views/Notes";
import { Logo } from "./components/Logo";
import { useSSE } from "./lib/useSSE";
import { cn } from "./lib/cn";
import { api } from "./lib/api";
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  Tag,
  Activity as ActivityIcon,
  Send,
  Database,
  Mic,
} from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, View: Dashboard },
  { id: "chats", label: "Chats", icon: MessageSquare, View: Chats },
  { id: "drafts", label: "Borradores", icon: FileText, View: Drafts },
  { id: "batch", label: "Batch", icon: Send, View: Batch },
  { id: "rag", label: "RAG", icon: Database, View: Rag },
  { id: "notes", label: "Notas", icon: Mic, View: Notes },
  { id: "labels", label: "Etiquetas", icon: Tag, View: Labels },
  { id: "activity", label: "Actividad", icon: ActivityIcon, View: ActivityView },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const qc = useQueryClient();

  useSSE("/api/events", {
    "wa-status": (data) => {
      qc.setQueryData(["wa"], data);
      qc.invalidateQueries({ queryKey: ["health"] });
    },
    "sender-status": (data) => {
      qc.setQueryData(["sender-status"], data);
    },
    message: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
    draft: (data) => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      const d = data as { content: string; chat_id: string };
      toast.info(`Nuevo borrador en ${d.chat_id}`, { description: d.content });
    },
    activity: (data) => {
      qc.setQueryData<unknown[]>(["activity"], (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        return [data, ...list].slice(0, 500);
      });
    },
    "batch-progress": () => {
      qc.invalidateQueries({ queryKey: ["batch-state"] });
    },
    "batch-state": (data) => {
      qc.setQueryData(["batch-state"], data);
    },
    error: (data) => {
      const e = data as { source: string; message: string };
      toast.error(`[${e.source}] ${e.message}`);
    },
  });

  const ActiveView = TABS.find((t) => t.id === tab)!.View;

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-4">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Logo />
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight text-zinc-100">
                  Doble
                </div>
                <div className="hidden text-[11px] text-zinc-500 sm:block">
                  tu doble en WhatsApp
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <AgentModePill />
              <ConnectionPill />
            </div>
          </div>
          <nav className="flex gap-0.5 overflow-x-auto [scrollbar-width:thin]">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "border-emerald-400 text-zinc-100"
                      : "border-transparent text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 overflow-y-auto p-4">
        <ActiveView />
      </main>
    </div>
  );
}

function Pill({
  tone,
  pulse,
  children,
}: {
  tone: "green" | "amber" | "red" | "zinc";
  pulse?: boolean;
  children: React.ReactNode;
}) {
  const tones = {
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    zinc: "border-zinc-700 bg-zinc-800/60 text-zinc-400",
  };
  const dots = {
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    red: "bg-red-400",
    zinc: "bg-zinc-500",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone]
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dots[tone], pulse && "animate-pulse")} />
      {children}
    </span>
  );
}

function ConnectionPill() {
  const { data } = useQuery({ queryKey: ["wa"], queryFn: api.wa.status });
  const conn = data?.connection;
  if (conn === "open") {
    return (
      <Pill tone="green">
        <span className="hidden sm:inline">WhatsApp conectado</span>
        <span className="sm:hidden">WA</span>
      </Pill>
    );
  }
  if (conn === "connecting") {
    return (
      <Pill tone="amber" pulse>
        <span className="hidden sm:inline">Conectando…</span>
        <span className="sm:hidden">WA</span>
      </Pill>
    );
  }
  return (
    <Pill tone="red">
      <span className="hidden sm:inline">Sin WhatsApp</span>
      <span className="sm:hidden">WA</span>
    </Pill>
  );
}

function AgentModePill() {
  const { data } = useQuery({ queryKey: ["state"], queryFn: api.state.get });
  if (!data) return null;
  if (!data.enabled) return <Pill tone="zinc">Agente apagado</Pill>;
  if (data.draft_mode) return <Pill tone="amber">Modo borrador</Pill>;
  return (
    <Pill tone="green" pulse>
      Auto-responde
    </Pill>
  );
}
