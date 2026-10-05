"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  GOOGLE_CONNECT_URL,
  disconnectGoogleAccount,
  setTaskStatus,
  setMessageHandled,
  sendChat,
  syncGmail,
  type CalendarEvent,
  type Client,
  type GoogleAccount,
  type GoogleTask,
  type Habit,
  type InboxMessage,
  type MemoryEntry,
  type Paper,
  type PlannerEvent,
  type Project,
  type ResearchLine,
  type ScheduleBlock,
  type ServiceHealth,
  type StudySession,
  type StudyTopic,
  type Subject,
  type Task,
  type VaultNoteMeta,
} from "@/lib/api";
import ChatPanel from "./chat-panel";
import MicButton from "./mic-button";
import HojeView from "./views/HojeView";
import TarefasView from "./views/TarefasView";
import ProjetosView from "./views/ProjetosView";
import CrmView from "./views/CrmView";
import EstudosView from "./views/EstudosView";
import PesquisaView from "./views/PesquisaView";
import InboxView from "./views/InboxView";
import MemoriaView from "./views/MemoriaView";
import NotasView from "./views/NotasView";
import TerminalView from "./views/TerminalView";
import SettingsView from "./views/SettingsView";
import NotificationsBanner from "./notifications-banner";

type ViewId =
  | "hoje"
  | "tarefas"
  | "projetos"
  | "crm"
  | "estudos"
  | "pesquisa"
  | "inbox"
  | "notas"
  | "terminal"
  | "memoria"
  | "configuracoes";

const NAV: { id: ViewId; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "tarefas", label: "Tarefas" },
  { id: "projetos", label: "Projetos" },
  { id: "crm", label: "CRM" },
  { id: "estudos", label: "Estudos" },
  { id: "pesquisa", label: "Pesquisa" },
  { id: "inbox", label: "Inbox" },
  { id: "notas", label: "Notas" },
  { id: "terminal", label: "Terminal" },
  { id: "memoria", label: "Memória" },
  { id: "configuracoes", label: "Configurações" },
];

export interface DashboardShellProps {
  projects: Project[];
  tasks: Task[];
  events: PlannerEvent[];
  clients: Client[];
  subjects: Subject[];
  researchLines: ResearchLine[];
  papers: Paper[];
  messages: InboxMessage[];
  habits: Habit[];
  memoryEntries: MemoryEntry[];
  googleAccounts: GoogleAccount[];
  calendarEvents: CalendarEvent[];
  googleTasks: GoogleTask[];
  notes: VaultNoteMeta[];
  studyTopics: StudyTopic[];
  schedule: ScheduleBlock[];
  studySessions: StudySession[];
  health: ServiceHealth;
}

export default function DashboardShell(props: DashboardShellProps) {
  const {
    projects,
    tasks,
    events,
    clients,
    subjects,
    researchLines,
    papers,
    messages,
    habits,
    memoryEntries,
    googleAccounts,
    calendarEvents,
    googleTasks,
    notes,
    studyTopics,
    schedule,
    studySessions,
    health,
  } = props;
  const router = useRouter();
  const [view, setView] = useState<ViewId>("hoje");
  const [chatOpen, setChatOpen] = useState(true);
  const [cmd, setCmd] = useState("");
  const [running, setRunning] = useState(false);
  const [bannerMsg, setBannerMsg] = useState("");
  const [syncing, setSyncing] = useState(false);

  const pendingCount = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length;
  const looseTasksPendingCount = tasks.filter(
    (t) => !t.projectId && t.status !== "done" && t.status !== "cancelled"
  ).length;
  const unhandledCount = messages.filter((m) => !m.handled).length;
  const today = new Date().toDateString();
  const eventsTodayCount = events.filter((e) => new Date(e.createdAt).toDateString() === today).length;
  const googleConnected = googleAccounts.length > 0;

  const badges: Record<ViewId, string> = {
    hoje: `${pendingCount} pend.`,
    tarefas: `${looseTasksPendingCount + googleTasks.filter((t) => t.status !== "completed").length} pend.`,
    projetos: String(projects.length),
    crm: String(clients.length),
    estudos: String(subjects.length),
    pesquisa: `${papers.length} artigos`,
    inbox: String(unhandledCount),
    notas: String(notes.length),
    terminal: "",
    memoria: String(memoryEntries.length),
    configuracoes: "",
  };

  function onChange() {
    router.refresh();
  }

  async function runCommand(override?: string) {
    const text = (override ?? cmd).trim();
    setCmd("");
    setRunning(true);
    setBannerMsg(text ? `Executando: "${text}"…` : "Planejando o dia…");
    try {
      const reply = await sendChat(
        text || "Planeje meu dia: liste minhas tarefas pendentes e diga por onde começar."
      );
      setBannerMsg(reply);
      onChange();
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : "erro ao executar comando");
    } finally {
      setRunning(false);
      setTimeout(() => setBannerMsg(""), 8000);
    }
  }

  async function toggleTask(task: Task) {
    await setTaskStatus(task.id, task.status === "done" ? "pending" : "done");
    onChange();
  }

  async function toggleMessageHandled(message: InboxMessage) {
    await setMessageHandled(message.id, !message.handled);
    onChange();
  }

  async function handleSyncGmail() {
    setSyncing(true);
    try {
      await syncGmail();
      onChange();
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnectAccount(email: string) {
    if (!confirm(`Desconectar ${email}? Gmail/Calendar/Tasks param de funcionar para essa conta.`)) return;
    await disconnectGoogleAccount(email);
    onChange();
  }

  return (
    <div className="app-shell">
      <NotificationsBanner />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-name">Planner Life</div>
          <div className="sidebar-brand-tag">v0.1 · nó local</div>
        </div>
        <div className="sidebar-divider" />

        <nav className="sidebar-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`sidebar-nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => setView(n.id)}
            >
              <span>{n.label}</span>
              <span className="sidebar-nav-badge">{badges[n.id]}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Google Workspace</div>
          <div className="sidebar-row">
            <span>Gmail</span>
            <span className={`status-dot ${googleConnected ? "on" : ""}`} />
          </div>
          <div className="sidebar-row">
            <span>Calendar</span>
            <span className={`status-dot ${googleConnected ? "on" : ""}`} />
          </div>
          <div className="sidebar-row">
            <span>Tasks</span>
            <span className={`status-dot ${googleConnected ? "on" : ""}`} />
          </div>
          {googleAccounts.map((acc) => (
            <div key={acc.email} className="sidebar-row" style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.email}</span>
              <button className="chat-listen" style={{ fontSize: 10, flex: "0 0 auto" }} onClick={() => handleDisconnectAccount(acc.email)}>
                desconectar
              </button>
            </div>
          ))}
          <a href={GOOGLE_CONNECT_URL} className="btn btn-secondary btn-block" style={{ marginTop: 4 }}>
            + Conectar conta
          </a>
        </div>

        <div className="sidebar-section footer">
          <div className="sidebar-section-title">Servicos locais</div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Core</span>
            <span className={`status-dot ${health.core ? "on" : ""}`} />
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Agent</span>
            <span className={`status-dot ${health.agent ? "on" : ""}`} />
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Voice</span>
            <span className={`status-dot ${health.voice ? "on" : ""}`} />
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <div className="topbar">
          <div className="topbar-input-wrap">
            <span className="topbar-label">Comando</span>
            <input
              className="topbar-input"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runCommand();
              }}
              placeholder="Planejar meu dia, criar tarefa, resumir artigo…"
            />
            <MicButton onFinalTranscript={(text) => runCommand(text)} onInterim={setCmd} />
          </div>
          <button className="pill-button pill-button-accent" onClick={() => runCommand()} disabled={running}>
            {running ? "Executando…" : "Executar"}
          </button>
          <button className="pill-button pill-button-outline" onClick={() => setChatOpen((v) => !v)}>
            {chatOpen ? "Fechar chat" : "Abrir chat"}
          </button>
        </div>

        {bannerMsg && (
          <div className="agent-banner">
            <span className="agent-banner-label">Planning Agent</span>
            <span className="agent-banner-text">{bannerMsg}</span>
          </div>
        )}

        <div className="body-row">
          <div className="view-main">
            {view === "hoje" && (
              <HojeView
                tasks={tasks}
                projects={projects}
                habits={habits}
                eventsTodayCount={eventsTodayCount}
                calendarEvents={calendarEvents}
                onToggleTask={toggleTask}
                onChange={onChange}
              />
            )}
            {view === "tarefas" && (
              <TarefasView tasks={tasks} googleTasks={googleTasks} onChange={onChange} />
            )}
            {view === "projetos" && (
              <ProjetosView projects={projects} tasks={tasks} onChange={onChange} />
            )}
            {view === "crm" && <CrmView clients={clients} onChange={onChange} />}
            {view === "estudos" && (
              <EstudosView
                subjects={subjects}
                topics={studyTopics}
                schedule={schedule}
                sessions={studySessions}
                onChange={onChange}
              />
            )}
            {view === "pesquisa" && (
              <PesquisaView lines={researchLines} papers={papers} onChange={onChange} />
            )}
            {view === "inbox" && (
              <InboxView
                messages={messages}
                googleAccounts={googleAccounts}
                onToggleHandled={toggleMessageHandled}
                onSyncGmail={handleSyncGmail}
                syncing={syncing}
                onChange={onChange}
              />
            )}
            {view === "notas" && <NotasView notes={notes} onChange={onChange} />}
            {view === "terminal" && <TerminalView />}
            {view === "memoria" && <MemoriaView entries={memoryEntries} onChange={onChange} />}
            {view === "configuracoes" && <SettingsView />}
          </div>

          {chatOpen && <ChatPanel onActivity={onChange} />}
        </div>
      </main>
    </div>
  );
}
