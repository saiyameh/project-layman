import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { RepoContext } from './preflight.js';
import type { ContributionGuide } from './reader.js';
import type { IntentResult } from './intent.js';

export interface CheckEvidence {
  command: string;
  kind: 'setup' | 'check';
  fingerprint: string;
  time: string;
  result: 'passed' | 'failed' | 'timeout' | 'interrupted';
  exitCode: number | null;
  output: string;
}
export interface ContributionSession {
  id: string;
  revision: number;
  repoPath: string;
  branch: string;
  originalBranch: string;
  originalRemotes: Record<string, string>;
  baseSha: string;
  ctx?: RepoContext;
  guide?: ContributionGuide;
  policyInterpretedHash?: string;
  reviewFingerprint?: string;
  intent?: IntentResult;
  rawIntent?: string;
  stage: 'preparing' | 'coding' | 'checking' | 'review' | 'publishing' | 'published' | 'merged' | 'closed' | 'paused' | 'cleaned';
  branchCreated: boolean;
  issueNumber?: number;
  issueCreated?: boolean;
  issueMarker?: string;
  issueDraft?: { title: string; body: string };
  pending?: 'issue' | 'branch' | 'commit' | 'push' | 'pr' | 'cleanup';
  commitSha?: string;
  committedFiles?: string[];
  indexHash?: string;
  pushCreated?: boolean;
  pushedSha?: string;
  remoteBefore?: string | null;
  prNumber?: number;
  prCreated?: boolean;
  prUrl?: string;
  checks: CheckEvidence[];
  acknowledgments: Record<string, string>;
  selectedFiles?: string[];
  preview?: { fingerprint: string; commit: string; title: string; body: string; base: string; draft: boolean };
  briefPath?: string;
  lastStatus?: unknown;
  error?: string;
  updatedAt: string;
}
interface Store { version: 2; sessions: ContributionSession[] }
const directory = () => path.join(os.homedir(), '.layman');
export const statePath = () => path.join(directory(), 'contributions.json');

export function loadSessions(): ContributionSession[] {
  if (!fs.existsSync(statePath())) return [];
  try {
    const store = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as Store;
    if (store.version !== 2 || !Array.isArray(store.sessions)) throw new Error();
    const ids = new Set<string>();
    for (const session of store.sessions) {
      if (!session || typeof session.id !== 'string' || ids.has(session.id) ||
          !Number.isInteger(session.revision) || typeof session.repoPath !== 'string' ||
          !path.isAbsolute(session.repoPath) || typeof session.branch !== 'string' ||
          typeof session.originalBranch !== 'string' || typeof session.baseSha !== 'string' ||
          !Array.isArray(session.checks) || !session.acknowledgments ||
          typeof session.branchCreated !== 'boolean' || !session.originalRemotes) throw new Error();
      ids.add(session.id);
    }
    return store.sessions;
  } catch {
    throw new Error(`Saved contribution state is invalid. Preserve ${statePath()} and repair it before retrying. No cleanup is allowed.`);
  }
}

export function saveSession(session: ContributionSession): void {
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const lock = `${statePath()}.lock`;
  let descriptor: number;
  try { descriptor = fs.openSync(lock, 'wx', 0o600); }
  catch { throw new Error(`Contribution state is locked. Stop the other Layman process. If it crashed, preserve state and remove ${lock}.`); }
  const temporary = `${statePath()}.${randomUUID()}.tmp`;
  try {
    const sessions = loadSessions();
    const position = sessions.findIndex(item => item.id === session.id);
    if (position >= 0 && sessions[position].revision !== session.revision) throw new Error('This contribution changed in another process. Run --resume again.');
    const saved = { ...session, revision: session.revision + 1, updatedAt: new Date().toISOString() };
    if (sessions.some(item => item.id !== session.id && item.repoPath === session.repoPath && item.branch === session.branch && item.stage !== 'cleaned')) {
      throw new Error('This branch already has a contribution. Resume that contribution.');
    }
    if (position >= 0) sessions[position] = saved;
    else sessions.push(saved);
    fs.writeFileSync(temporary, JSON.stringify({ version: 2, sessions }), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, statePath());
    Object.assign(session, saved);
  } finally {
    fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.unlinkSync(lock);
  }
}

export function newSession(repoPath: string, originalBranch: string, originalRemotes: Record<string, string>, baseSha: string): ContributionSession {
  const id = randomUUID();
  return { id, revision: 0, repoPath, branch: `pending-${id}`, originalBranch, originalRemotes, baseSha,
    stage: 'preparing', branchCreated: false, checks: [], acknowledgments: {}, updatedAt: new Date().toISOString() };
}

export function findSession(repoPath: string, branch: string): ContributionSession | undefined {
  const candidates = loadSessions().filter(item => item.repoPath === repoPath && item.stage !== 'cleaned');
  const exact = candidates.find(item => item.branch === branch);
  if (exact) return exact;
  const pending = candidates.filter(item => item.branch.startsWith('pending-') && item.originalBranch === branch);
  if (pending.length === 1) return pending[0];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new Error('This repo has several contributions. Check out the contribution branch, then run --resume.');
  return undefined;
}
