// HTTP API that the Brain Office uses in place of the old Next.js server actions.
// Every call is `POST /rpc/<name>` with a JSON array of arguments. Only the functions listed in
// RPC are reachable: destructive maintenance (resetDb, seedDemo) stays CLI-only.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import * as brain from '@mcb/core';
import { disableSchedule, enableSchedule, scheduleStatus } from './system.js';

type Fn = (...args: never[]) => unknown;

const RPC: Record<string, Fn> = {
  // reads
  getProfile: brain.getProfile,
  getPulse: brain.getPulse,
  getBrief: brain.getBrief,
  getContent: brain.getContent,
  listContent: brain.listContent,
  listArchive: brain.listArchive,
  archiveCounts: brain.archiveCounts,
  search: brain.search,
  listSources: brain.listSources,
  getSourceStats: brain.getSourceStats,
  getSourceGraph: brain.getSourceGraph,
  getKnowledgeGraph: brain.getKnowledgeGraph,
  listKnowledge: brain.listKnowledge,
  listGaps: brain.listGaps,
  getKnowledgeByName: brain.getKnowledgeByName,
  listLearning: brain.listLearning,
  getLearning: brain.getLearning,
  learningReadings: brain.learningReadings,
  listLearningPaths: brain.listLearningPaths,
  listGoals: brain.listGoals,
  getGoal: brain.getGoal,
  listResources: brain.listResources,
  listProjects: brain.listProjects,
  getProject: brain.getProject,
  projectProgress: brain.projectProgress,
  listSuggestedProjects: brain.listSuggestedProjects,
  getSuggestedProject: brain.getSuggestedProject,
  listRejectedProjects: brain.listRejectedProjects,
  listBuildWatch: brain.listBuildWatch,
  listMilestones: brain.listMilestones,
  catchupProgress: brain.catchupProgress,
  listCreators: brain.listCreators,
  getCreator: brain.getCreator,
  listCreatorPosts: brain.listCreatorPosts,
  listTrendingRepos: brain.listTrendingRepos,
  getEvolution: brain.getEvolution,
  listFeedback: brain.listFeedback,
  listAgentRuns: brain.listAgentRuns,
  listRunMetrics: brain.listRunMetrics,
  listToolStats: brain.listToolStats,
  listMcpSessions: brain.listMcpSessions,
  listPendingReviews: brain.listPendingReviews,
  lastUpdatedAt: brain.lastUpdatedAt,
  catalog: () => ({
    areas: brain.AREAS,
    topics: brain.TOPIC_CATALOG,
    techs: brain.TECH_CATALOG,
    roles: brain.ROLE_OPTIONS,
    building: brain.BUILDING_OPTIONS,
    platforms: brain.PLATFORM_LABEL,
  }),
  // writes (same semantics as the old web app's server actions)
  toggleSaved: brain.toggleSaved,
  addFeedback: (id: string, signal: brain.FeedbackSignal) => {
    brain.addFeedback(id, signal);
    if (signal === 'not_for_me') brain.setUserState(id, 'IGNORED');
  },
  setUserState: brain.setUserState,
  cycleProjectTask: brain.cycleProjectTask,
  acceptSuggestedProject: brain.acceptSuggestedProject,
  rejectProject: brain.rejectProject,
  restoreProject: brain.restoreProject,
  advanceLearning: brain.advanceLearning,
  completeLearningStep: brain.completeLearningStep,
  answerLearningStep: brain.answerLearningStep,
  study: (contentId: string) => {
    const c = brain.getContent(contentId);
    if (!c?.learnTopic) return null;
    const k = brain.getKnowledgeByName(c.learnTopic);
    const item = brain.upsertLearning({
      title: c.learnTopic,
      track: k?.domain.toUpperCase() ?? null,
      why: c.whyItMatters,
      sourceContentId: c.id,
    });
    brain.setUserState(c.id, 'LEARNING');
    return { id: item.id };
  },
  saveProfile: (patch: Partial<brain.Profile>) => {
    brain.saveProfile(patch);
    brain.syncTopicSources();
  },
  saveOnboarding: (patch: Partial<brain.Profile>) => {
    brain.saveProfile({ ...patch, onboarded: true });
    brain.seedInit();
    brain.syncTopicSources();
  },
  setSourceEnabled: brain.setSourceEnabled,
  addSource: (input: { url: string; name: string; area?: string; everyMinutes?: number }) => {
    const url = String(input.url ?? '').trim();
    const name = String(input.name ?? '').trim();
    if (!/^https?:\/\//.test(url) || !name) throw new Error('URL e nome são obrigatórios');
    return brain.upsertSource({
      kind: url.includes('hn.algolia.com') ? 'hn' : 'rss',
      name,
      url,
      defaultArea: (brain.AREAS as readonly string[]).includes(input.area ?? '')
        ? (input.area as brain.Area)
        : null,
      everyMinutes: Number(input.everyMinutes) || 60,
    });
  },
  ingestNow: async () => {
    brain.seedInit();
    brain.syncTopicSources();
    const report = await brain.ingestSources({ force: true });
    return {
      inserted: report.reduce((a, r) => a + r.inserted, 0),
      errors: report.filter((r) => r.error).length,
    };
  },
  addLink: brain.addLink,
  createGoal: (text: string) =>
    String(text).trim().length < 3 ? null : { id: brain.createGoal(text).id },
  archiveGoal: brain.archiveGoal,
  toggleResourceDone: brain.toggleResourceDone,
  setMilestoneState: brain.setMilestoneState,
  backfillHistory: (months: number) => brain.backfillHistory({ months }),
  addCreator: (name: string, links: string[]) => brain.addCreator({ name, links }),
  setCreatorStatus: brain.setCreatorStatus,
  collectGithub: brain.collectGithub,
  saveRsshub: (url: string) => brain.saveProfile({ rsshubUrl: String(url).trim() || null }),
  rescueContent: brain.rescueContent,
  // system
  scheduleStatus,
  enableSchedule: (dailyAt: string) =>
    enableSchedule(/^\d{2}:\d{2}$/.test(dailyAt) ? dailyAt : '07:00'),
  disableSchedule,
};

const TASKS = /^(daily|weekly|catchup(:.*)?|lesson(:.*)?|plan(:.*)?|projects(:.*)?|research: .+)$/;

export function createApi(repoRoot: string, token: string) {
  const logs = join(repoRoot, 'logs');
  const readJsonl = (file: string, limit = 300) =>
    !existsSync(file)
      ? []
      : readFileSync(file, 'utf8')
          .replace(/^﻿/, '')
          .split('\n')
          .filter(Boolean)
          .slice(-limit)
          .flatMap((l) => {
            try {
              return [JSON.parse(l)];
            } catch {
              return [];
            }
          })
          .reverse();
  const running = new Map<string, { task: string; startedAt: string }>();

  const extra: Record<string, Fn> = {
    agentMetrics: () => {
      const dir = join(repoRoot, '.claude', 'agents');
      const promptSizes: Record<string, number> = {};
      if (existsSync(dir))
        for (const f of readdirSync(dir).filter((f) => f.endsWith('.md')))
          promptSizes[f.replace(/\.md$/, '')] = Buffer.byteLength(
            readFileSync(join(dir, f), 'utf8').replace(/^---[\s\S]*?\n---\n/, ''),
          );
      const fp = join(dirname(brain.resolveDbPath()), 'footprint.json');
      return {
        runs: readJsonl(join(logs, 'runs.jsonl')),
        hookBlocks: readJsonl(join(logs, 'hook-blocks.jsonl')),
        footprint: existsSync(fp) ? JSON.parse(readFileSync(fp, 'utf8')) : null,
        promptSizes,
        running: [...running.values()],
      };
    },
    /** Runs a curator phase headless with the user's Claude subscription (scripts/run-agent.ps1). */
    runTask: (task: string) => {
      const t = String(task ?? '').trim();
      if (!TASKS.test(t)) throw new Error('tarefa inválida');
      if (process.platform !== 'win32')
        throw new Error('disponível só no Windows (scripts/run-agent.ps1)');
      if ([...running.values()].some((r) => r.task === t))
        return { started: false, message: 'já está rodando' };
      const id = `${Date.now()}`;
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(repoRoot, 'scripts', 'run-agent.ps1'),
          '-Task',
          t,
        ],
        { cwd: repoRoot, windowsHide: true, stdio: 'ignore', env: process.env },
      );
      running.set(id, { task: t, startedAt: new Date().toISOString() });
      child.on('exit', () => running.delete(id));
      child.on('error', () => running.delete(id));
      return { started: true, message: `Fase "${t}" iniciada.` };
    },
  };

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = /^\/rpc\/([A-Za-z]+)$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? null));
    };
    // A header forces a CORS preflight, which this server never answers: other local pages can't call us.
    if (req.method !== 'POST' || req.headers['x-svc-token'] !== token) {
      send(403, { error: 'proibido' });
      return true;
    }
    const fn = RPC[m[1]] ?? extra[m[1]];
    if (!fn) {
      send(404, { error: `função desconhecida: ${m[1]}` });
      return true;
    }
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) {
        send(413, { error: 'corpo grande demais' });
        return true;
      }
    }
    try {
      const args = raw ? JSON.parse(raw) : [];
      const out = await (fn as (...a: unknown[]) => unknown)(
        ...(Array.isArray(args) ? args : [args]),
      );
      send(200, { result: out ?? null });
    } catch (e) {
      send(400, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  };
}
