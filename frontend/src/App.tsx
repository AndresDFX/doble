import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dashboard } from "./views/Dashboard";
import { Chats } from "./views/Chats";
import { Drafts } from "./views/Drafts";
import { Labels } from "./views/Labels";
import { useSSE } from "./lib/useSSE";
import { cn } from "./lib/cn";
import { LayoutDashboard, MessageSquare, FileText, Tag } from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, View: Dashboard },
  { id: "chats", label: "Chats", icon: MessageSquare, View: Chats },
  { id: "drafts", label: "Borradores", icon: FileText, View: Drafts },
  { id: "labels", label: "Etiquetas", icon: Tag, View: Labels },
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
    message: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
    draft: (data) => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      const d = data as { content: string; chat_id: string };
      toast.info(`Nuevo borrador en ${d.chat_id}`, { description: d.content });
    },
    error: (data) => {
      const e = data as { source: string; message: string };
      toast.error(`[${e.source}] ${e.message}`);
    },
  });

  const ActiveView = TABS.find((t) => t.id === tab)!.View;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <h1 className="text-sm font-semibold tracking-tight">
            <span className="text-emerald-400">wa</span>-agent admin
          </h1>
          <nav className="flex gap-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                    tab === t.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
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
