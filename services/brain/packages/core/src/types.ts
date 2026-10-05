// Domain types shared by the web app and the MCP server.
// Mirrors docs/PTR.md (§43) in a single-user, SQLite-first form, shaped by docs/design/My Current Brain.dc.html.

export const AREAS = ['now', 'learn', 'build', 'frontier'] as const;
export type Area = (typeof AREAS)[number];

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CATEGORIES = [
  'NEWS',
  'RELEASE',
  'TOOL',
  'LIBRARY',
  'FRAMEWORK',
  'LANGUAGE',
  'AI',
  'RESEARCH',
  'TUTORIAL',
  'PROJECT',
  'ARCHITECTURE',
  'SECURITY',
  'DEVOPS',
  'DATABASE',
  'CAREER',
  // Frontier-only categories (Design Brief §24)
  'EMERGING',
  'EXPERIMENTAL',
  'OPEN_SOURCE',
  'EARLY_STAGE',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ContentStatus = 'pending' | 'analyzed' | 'ignored' | 'duplicate';

export const USER_STATES = ['UNREAD', 'READ', 'SAVED', 'LEARNING', 'COMPLETED', 'IGNORED'] as const;
export type UserState = (typeof USER_STATES)[number];

export const FEEDBACK_SIGNALS = [
  'useful',
  'not_useful',
  'not_for_me',
  'very_relevant',
  'later',
] as const;
export type FeedbackSignal = (typeof FEEDBACK_SIGNALS)[number];

export const KNOWLEDGE_STATUSES = [
  'DISCOVERED',
  'LEARNING',
  'PRACTICING',
  'APPLIED',
  'MASTERED',
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const PROJECT_STATUSES = [
  'IDEA',
  'PLANNED',
  'BUILDING',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type InterestPriority = 'high' | 'medium' | 'low';

export interface Profile {
  onboarded: boolean;
  name: string;
  role: string;
  /** What the user is trying to become — multiple allowed. */
  becoming: string[];
  technologies: string[];
  building: string[];
  interests: { name: string; priority: InterestPriority }[];
  minutesPerDay: number;
  /** Anti-overload daily caps (PTD §32). */
  limits: Record<Area, number>;
  language: string;
  /** Optional self-hosted RSSHub (https://docs.rsshub.app) for Instagram/TikTok/X/Threads feeds. */
  rsshubUrl: string | null;
}

/**
 * rss          RSS/Atom feed (blogs, GitHub releases, YouTube channels, Reddit, arXiv…)
 * hn           Hacker News Algolia query URL
 * github_search GitHub repository search API URL (autonomous discovery by topic)
 * page         Plain web page with no feed — checked by the agent with WebFetch
 */
export type SourceKind = 'rss' | 'hn' | 'github_search' | 'page' | 'social';

/** Where a channel lives. Feeds exist for most; Instagram/TikTok/X need an RSS bridge or the agent. */
export const PLATFORMS = [
  'youtube',
  'instagram',
  'tiktok',
  'x',
  'threads',
  'bluesky',
  'mastodon',
  'linkedin',
  'twitch',
  'kick',
  'vimeo',
  'reddit',
  'github',
  'medium',
  'devto',
  'substack',
  'podcast',
  'blog',
  'web',
] as const;
export type Platform = (typeof PLATFORMS)[number];
export type SourceOrigin = 'default' | 'user' | 'link' | 'interest' | 'agent';

export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  url: string;
  defaultArea: Area | null;
  /** Suggested collection cadence in minutes (PTR §45). */
  everyMinutes: number;
  origin: SourceOrigin;
  /** Interest/goal that created this source, for autonomous topic sources. */
  topic: string | null;
  platform: Platform | null;
  /** Person this channel belongs to (Pessoas). */
  creatorId: string | null;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
}

/** The four explain modes on the content page (PTD §20). */
export interface Explain {
  code?: string;
  architecture?: string;
  application?: string;
}

export interface Content {
  id: string;
  sourceId: string;
  sourceName: string;
  externalId: string;
  url: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  /** Source fact: raw excerpt as retrieved. Never rewritten by the agent (PTR §66). */
  excerpt: string | null;
  status: ContentStatus;
  duplicateOf: string | null;
  // ── AI interpretation layer — filled by the curator agent ──
  area: Area | null;
  category: Category | null;
  /** Factual summary grounded in the source. */
  summary: string | null;
  /** Personal context: why this matters to *this* user. */
  whyItMatters: string | null;
  keyPoints: string[];
  explain: Explain;
  tags: string[];
  priority: Priority | null;
  readMinutes: number | null;
  relatedKnowledge: string[];
  /** Concept to study next because of this item ("Estudar Tool Calling"). */
  learnTopic: string | null;
  /** Frontier only: 1–5 maturity and a short signal line ("3 papers · 2 repos"). */
  maturity: number | null;
  signals: string | null;
  analyzedAt: string | null;
  /** Collected by catch-up (history backfill), not by the daily flow. */
  backfill: boolean;
  creatorId: string | null;
  // ── User layer ──
  userState: UserState;
  feedback: FeedbackSignal | null;
}

export interface ContentAnalysis {
  area: Area;
  category: Category;
  summary: string;
  whyItMatters: string;
  keyPoints: string[];
  tags: string[];
  priority: Priority;
  readMinutes: number;
  explain?: Explain;
  relatedKnowledge?: string[];
  learnTopic?: string | null;
  maturity?: number | null;
  signals?: string | null;
}

export interface KnowledgeEvidence {
  kind: 'studied' | 'exercise' | 'applied' | 'project' | 'tutorial' | 'used' | 'seen';
  note: string;
  at: string;
}

export interface Knowledge {
  id: string;
  name: string;
  fullName: string | null;
  domain: string;
  description: string | null;
  status: KnowledgeStatus;
  /** 0–10, grows with evidence (PTR RF-016). */
  confidence: number;
  related: string[];
  evidence: KnowledgeEvidence[];
  nextStep: string | null;
  /** When set, the concept is a detected gap (PTR RF-017) and this is why. */
  gapReason: string | null;
  /** Optional manual position on the map, in % of the canvas. */
  pos: { x: number; y: number } | null;
  createdAt: string;
  lastReviewed: string | null;
}

export interface ProjectTask {
  title: string;
  status: TaskStatus;
}

export interface Project {
  id: string;
  name: string;
  goal: string | null;
  status: ProjectStatus;
  difficulty: string | null;
  estimatedTime: string | null;
  technologies: string[];
  prerequisites: { name: string; known: boolean }[];
  tasks: ProjectTask[];
  /** Suggested by the agent ("CONSTRUA COM ISTO · IA"), not yet accepted. */
  aiSuggested: boolean;
  reason: string | null;
  /** Why the user rejected it — the agent uses this to suggest better alternatives. */
  rejection: string | null;
  rejectedAt: string | null;
  sourceContentId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  /** Index of the correct option. */
  answer: number;
  explanation: string;
}

export interface LearningStep {
  name: string;
  minutes: number;
  kind?: 'concept' | 'example' | 'code' | 'exercise' | 'quiz' | 'reading';
  /** Lesson text (Markdown), written by the agent from verified sources. */
  body?: string;
  code?: { language: string; source: string; caption?: string };
  /** Exercise prompt the user answers in their own words. */
  exercise?: string;
  quiz?: QuizQuestion[];
  /** User's answer to the exercise. */
  answer?: string;
  answeredAt?: string;
  /** Agent's review of the user's answer. */
  feedback?: string;
}

export interface LearningItem {
  id: string;
  title: string;
  track: string | null;
  why: string | null;
  steps: LearningStep[];
  /** Number of steps completed. */
  stepsDone: number;
  progress: number;
  minutesTotal: number;
  sourceContentId: string | null;
  /** Sources the lesson was written from. */
  sources: { title: string; url: string }[];
  /** When the agent wrote the lesson content (null = only an outline). */
  writtenAt: string | null;
  updatedAt: string;
}

export type PathModuleStatus = 'done' | 'current' | 'gap' | 'todo';

export interface LearningPath {
  id: string;
  goalId: string | null;
  name: string;
  goal: string | null;
  modules: { title: string; status: PathModuleStatus }[];
  updatedAt: string;
}

export interface BuildWatchUpdate {
  id: string;
  project: string;
  author: string | null;
  url: string;
  changes: { sign: '+' | '-' | '~'; text: string }[];
  technologies: string[];
  why: string | null;
  happenedAt: string;
}

export interface BriefSection {
  kind: 'important' | 'learn' | 'build' | 'watch' | 'frontier';
  label: string;
  title: string;
  meta?: string;
  contentId?: string;
}

export interface Brief {
  date: string;
  type: 'daily' | 'weekly';
  headline: string;
  intro: string | null;
  /** Content ids of the top items, in order ("01", "02", "03"). */
  itemIds: string[];
  blocks: BriefSection[];
  nextMove: { title: string; action: string; href: string } | null;
  stats: Record<string, number>;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  task: string;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  stats: Record<string, number>;
}

export const GOAL_STATUSES = ['new', 'planning', 'active', 'done', 'archived'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** A learning goal described by the user in their own words ("quero aprender Rust para CLIs"). */
export interface Goal {
  id: string;
  text: string;
  status: GoalStatus;
  pathId: string | null;
  /** Agent's note on how the plan was built / what's next. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const RESOURCE_KINDS = [
  'video',
  'tutorial',
  'course',
  'docs',
  'article',
  'book',
  'paper',
  'repo',
  'exercise',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Curated study material (videos, tutorials, docs…) attached to a goal / path module. */
export interface LearningResource {
  id: string;
  goalId: string | null;
  pathId: string | null;
  module: string | null;
  kind: ResourceKind;
  title: string;
  url: string;
  author: string | null;
  minutes: number | null;
  level: 'iniciante' | 'intermediário' | 'avançado' | null;
  language: string | null;
  why: string | null;
  done: boolean;
  createdAt: string;
}

export const MILESTONE_IMPORTANCE = ['essential', 'important', 'nice'] as const;
export type MilestoneImportance = (typeof MILESTONE_IMPORTANCE)[number];
export type MilestoneState = 'todo' | 'known' | 'studying' | 'skipped';

/** Catch-up: a curated "what changed" milestone in a technology over the last months. */
export interface Milestone {
  id: string;
  topic: string;
  happenedAt: string;
  title: string;
  summary: string;
  why: string | null;
  importance: MilestoneImportance;
  links: { title: string; url: string }[];
  contentId: string | null;
  state: MilestoneState;
  createdAt: string;
}

/** A person worth following (tech news presenters, builders), across any platform. */
export interface Creator {
  id: string;
  name: string;
  bio: string | null;
  topics: string[];
  status: 'following' | 'suggested' | 'muted';
  /** Why the agent suggested this person. */
  reason: string | null;
  createdAt: string;
}

export interface CreatorChannel {
  sourceId: string;
  platform: Platform | null;
  kind: SourceKind;
  url: string;
  name: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export interface Repo {
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  createdAt: string | null;
  pushedAt: string | null;
  firstSeen: string;
  refreshedAt: string | null;
  /** AI layer: why this repo matters to the user. */
  whyItMatters: string | null;
  /** How it was found: trending, search, mention, release… */
  via: string | null;
}
