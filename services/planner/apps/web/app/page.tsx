import {
  getCalendarEvents,
  getClients,
  getEvents,
  getGoogleStatus,
  getGoogleTasks,
  getHabits,
  getMemory,
  getMessages,
  getPapers,
  getProjects,
  getResearchLines,
  getSchedule,
  getServiceHealth,
  getStudySessions,
  getStudyTopics,
  getSubjects,
  getTasks,
  getVaultNotes,
} from "@/lib/api";
import DashboardShell from "./dashboard-shell";

export default async function Home() {
  const [
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
    googleStatus,
    calendarEvents,
    googleTasks,
    notes,
    studyTopics,
    schedule,
    studySessions,
    health,
  ] = await Promise.all([
    getProjects(),
    getTasks(),
    getEvents(30),
    getClients(),
    getSubjects(),
    getResearchLines(),
    getPapers(),
    getMessages(),
    getHabits(),
    getMemory(),
    getGoogleStatus(),
    getCalendarEvents(8),
    getGoogleTasks(),
    getVaultNotes(),
    getStudyTopics(),
    getSchedule(),
    getStudySessions(14),
    getServiceHealth(),
  ]);

  return (
    <DashboardShell
      projects={projects}
      tasks={tasks}
      events={events}
      clients={clients}
      subjects={subjects}
      researchLines={researchLines}
      papers={papers}
      messages={messages}
      habits={habits}
      memoryEntries={memoryEntries}
      googleAccounts={googleStatus.accounts}
      calendarEvents={calendarEvents}
      googleTasks={googleTasks}
      notes={notes}
      studyTopics={studyTopics}
      schedule={schedule}
      studySessions={studySessions}
      health={health}
    />
  );
}
