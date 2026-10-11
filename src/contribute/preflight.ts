import path from 'node:path';
import fs from 'node:fs';
import { Octokit } from '@octokit/rest';
import simpleGit, { type SimpleGit } from 'simple-git';
import { getAuthenticatedUser } from '../github.js';
import type { LaymanConfig } from '../config.js';
import { getLLMConfigError } from './llm.js';

export interface RepoContext {
  repoPath: string; upstreamOwner: string; upstreamRepo: string; forkOwner: string;
  defaultBranch: string; language: string[]; cloneProtocol: 'https' | 'ssh';
  pushOwner?: string; pushRepo?: string; baseRemote?: string; originalBranch?: string;
  originalRemotes?: Record<string, string>; baseSha?: string;
}

interface GitHubRepo {
  owner: { login: string }; name: string; fork: boolean;
  parent?: { owner: { login: string }; name: string };
  permissions?: { push?: boolean }; archived: boolean; disabled: boolean; default_branch: string;
}

export interface GitHubClient {
  repos: {
    get(args: { owner: string; repo: string }): Promise<{ data: GitHubRepo }>;
    createFork(args: { owner: string; repo: string }): Promise<unknown>;
    listForAuthenticatedUser(args: { affiliation: 'owner'; per_page: number }): Promise<{ data: Array<Pick<GitHubRepo, 'owner' | 'name' | 'fork'>> }>;
  };
  paginate(method: GitHubClient['repos']['listForAuthenticatedUser'], args: { affiliation: 'owner'; per_page: number }): Promise<Array<Pick<GitHubRepo, 'owner' | 'name' | 'fork'>>>;
}

export interface PreflightOptions { resume?: boolean; client?: GitHubClient; forkOwner?: string; }
interface GitRef { owner: string; repo: string }
interface RepoIdentity { base: GitRef; push: GitRef; originIsPush: boolean }
class LocalPreflightError extends Error {}

export function parseGitUrl(url: string): GitRef | null {
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return https ? { owner: https[1], repo: https[2] } : null;
}

function sameRepo(left: GitRef, right: GitRef): boolean {
  return left.owner.toLowerCase() === right.owner.toLowerCase() && left.repo.toLowerCase() === right.repo.toLowerCase();
}
function parentOf(repo: GitHubRepo): GitRef | null {
  return repo.fork && repo.parent ? { owner: repo.parent.owner.login, repo: repo.parent.name } : null;
}
function isNotFound(error: unknown): boolean { return (error as { status?: number }).status === 404; }
function formatRepo(ref: GitRef): string { return `${ref.owner}/${ref.repo}`; }
function remoteUrl(ref: GitRef, protocol: 'https' | 'ssh'): string {
  return protocol === 'ssh' ? `git@github.com:${ref.owner}/${ref.repo}.git` : `https://github.com/${ref.owner}/${ref.repo}.git`;
}

async function findFork(client: GitHubClient, owner: string, base: GitRef): Promise<GitRef | null> {
  const listed = await client.paginate(client.repos.listForAuthenticatedUser, { affiliation: 'owner', per_page: 100 });
  for (const repo of listed) {
    if (!repo.fork) continue;
    try {
      const { data } = await client.repos.get({ owner, repo: repo.name });
      const parent = parentOf(data);
      if (parent && sameRepo(parent, base)) return { owner, repo: data.name };
    } catch (error) { if (!isNotFound(error)) throw error; }
  }
  return null;
}

/** Resolve forks by their parent identity, so a renamed fork never matches by name alone. */
async function requireActiveBase(client: GitHubClient, base: GitRef): Promise<void> {
  const { data } = await client.repos.get(base);
  if (data.archived) throw new LocalPreflightError(`${formatRepo(base)} is archived.`);
  if (data.disabled) throw new LocalPreflightError(`${formatRepo(base)} is disabled.`);
  if (!data.default_branch) throw new LocalPreflightError(`${formatRepo(base)} has no default branch.`);
}

export async function resolveRepoIdentity(client: GitHubClient, forkOwner: string, origin: GitRef, resume = false): Promise<RepoIdentity> {
  const { data: originRepo } = await client.repos.get(origin);
  const parent = parentOf(originRepo);
  const base = parent ?? { owner: originRepo.owner.login, repo: originRepo.name };
  await requireActiveBase(client, base);
  if (parent && (originRepo.owner.login.toLowerCase() === forkOwner.toLowerCase() || originRepo.permissions?.push)) {
    return { base, push: origin, originIsPush: true };
  }
  if (originRepo.permissions?.push) return { base, push: base, originIsPush: true };

  const exact = await client.repos.get({ owner: forkOwner, repo: base.repo }).then(({ data }) => data).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  const exactParent = exact ? parentOf(exact) : null;
  if (exact && exactParent && sameRepo(exactParent, base)) {
    const push = { owner: forkOwner, repo: exact.name };
    return { base, push, originIsPush: sameRepo(origin, push) };
  }
  const found = await findFork(client, forkOwner, base);
  if (found) return { base, push: found, originIsPush: sameRepo(origin, found) };
  if (exact) throw new LocalPreflightError(`${forkOwner}/${base.repo} exists but is not a fork of ${formatRepo(base)}.`);
  if (resume) throw new LocalPreflightError('Resume cannot create a fork. Run a new preparation first.');

  await client.repos.createFork(base);
  const { data: created } = await client.repos.get({ owner: forkOwner, repo: base.repo });
  const createdParent = parentOf(created);
  if (!createdParent || !sameRepo(createdParent, base)) throw new LocalPreflightError(`Fork ${forkOwner}/${base.repo} does not point to ${formatRepo(base)}.`);
  const push = { owner: forkOwner, repo: created.name };
  return { base, push, originIsPush: sameRepo(origin, push) };
}

function detectLanguages(repoPath: string): string[] {
  const indicators = [['package.json', 'js'], ['go.mod', 'go'], ['Cargo.toml', 'rust'], ['requirements.txt', 'python'], ['setup.py', 'python'], ['pyproject.toml', 'python']] as const;
  const languages = [...new Set(indicators.filter(([file]) => fs.existsSync(path.join(repoPath, file))).map(([, language]) => language))];
  return languages.length ? languages : ['unknown'];
}

async function requireSafeWorktree(git: SimpleGit, resume = false): Promise<{ repoPath: string; branch: string }> {
  let repoPath: string;
  try { repoPath = (await git.revparse(['--show-toplevel'])).trim(); } catch { throw new Error('This folder is not a Git repository.'); }
  const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  if (branch === 'HEAD') throw new Error('HEAD is detached. Check out a branch first.');
  const status = await git.status();
  if (status.conflicted.length) throw new Error('Git has merge conflicts. Resolve them first.');
  if (!resume && !status.isClean()) throw new Error('Git has uncommitted work. Commit or stash it first.');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    const markerPath = (await git.revparse(['--git-path', marker])).trim();
    if (fs.existsSync(path.resolve(repoPath, markerPath))) throw new Error('A Git operation is not finished. Complete or abort it first.');
  }
  for (const rebaseDir of ['rebase-merge', 'rebase-apply']) {
    const gitPath = (await git.revparse(['--git-path', rebaseDir])).trim();
    if (fs.existsSync(path.resolve(repoPath, gitPath))) throw new Error('A rebase is not finished. Complete or abort it first.');
  }
  return { repoPath, branch };
}

export async function assertSafeWorktree(repoPath: string, resume = false): Promise<{ repoPath: string; branch: string }> {
  return requireSafeWorktree(simpleGit(path.resolve(repoPath)), resume);
}

function repoFailure(error: unknown, ref: GitRef): Error {
  const status = (error as { status?: number }).status;
  if (status === 404) return new Error(`Cannot read ${formatRepo(ref)}. Check access.`);
  if (status === 401 || status === 403) return new Error('The GitHub token cannot read this repository.');
  return new Error(`Cannot verify ${formatRepo(ref)}.`);
}

export async function runPreflight(repoPath: string, config: LaymanConfig, options: PreflightOptions = {}): Promise<RepoContext> {
  const llmError = getLLMConfigError(config.llm);
  if (llmError) throw new Error(llmError);
  const git = simpleGit(path.resolve(repoPath));
  const { repoPath: root, branch } = await requireSafeWorktree(git, options.resume);
  const remotes = await git.getRemotes(true);
  const originalRemotes = Object.fromEntries(remotes.map(remote => [remote.name, remote.refs.fetch]));
  const originUrl = originalRemotes.origin;
  const origin = originUrl && parseGitUrl(originUrl);
  if (!origin) throw new Error('A GitHub origin remote is required.');
  const protocol: 'https' | 'ssh' = originUrl.startsWith('git@') ? 'ssh' : 'https';
  const client = options.client ?? new Octokit({ auth: config.github_token, userAgent: 'project-layman' }) as unknown as GitHubClient;
  const forkOwner = options.forkOwner ?? await getAuthenticatedUser(config.github_token);
  let identity: RepoIdentity;
  try { identity = await resolveRepoIdentity(client, forkOwner, origin, options.resume); }
  catch (error) { if (error instanceof LocalPreflightError) throw error; throw repoFailure(error, origin); }
  let baseData: GitHubRepo;
  try { ({ data: baseData } = await client.repos.get(identity.base)); } catch (error) { throw repoFailure(error, identity.base); }
  if (baseData.archived) throw new Error(`${formatRepo(identity.base)} is archived.`);
  if (baseData.disabled) throw new Error(`${formatRepo(identity.base)} is disabled.`);
  if (!baseData.default_branch) throw new Error(`${formatRepo(identity.base)} has no default branch.`);
  const existingUpstream = originalRemotes.upstream && parseGitUrl(originalRemotes.upstream);
  if (originalRemotes.upstream && !existingUpstream) throw new Error('The upstream remote is not a GitHub remote.');
  if (existingUpstream) {
    let upstreamData: GitHubRepo;
    try { ({ data: upstreamData } = await client.repos.get(existingUpstream)); } catch (error) { throw repoFailure(error, existingUpstream); }
    const upstreamBase = { owner: upstreamData.owner.login, repo: upstreamData.name };
    if (!sameRepo(upstreamBase, identity.base)) throw new Error(`The upstream remote is ${formatRepo(existingUpstream)}, but the base is ${formatRepo(identity.base)}.`);
  }
  if (options.resume && (!identity.originIsPush || (!existingUpstream && !sameRepo(identity.base, identity.push)))) throw new Error('Resume will not change remotes. Run a new preparation first.');
  if (!options.resume) {
    if (!identity.originIsPush) await git.remote(['set-url', 'origin', remoteUrl(identity.push, protocol)]);
    if (!sameRepo(identity.base, identity.push) && !existingUpstream) await git.addRemote('upstream', remoteUrl(identity.base, protocol));
  }
  const baseRemote = sameRepo(identity.base, identity.push) ? 'origin' : 'upstream';
  try { await git.fetch(baseRemote, baseData.default_branch); await git.raw(['ls-remote', '--heads', 'origin']); }
  catch { throw new Error('Cannot reach Git remotes. Check access and try again.'); }
  let baseSha: string;
  try { baseSha = (await git.revparse([`${baseRemote}/${baseData.default_branch}`])).trim(); }
  catch { throw new Error(`Cannot find ${baseRemote}/${baseData.default_branch}.`); }
  return { repoPath: root, upstreamOwner: identity.base.owner, upstreamRepo: identity.base.repo, forkOwner, defaultBranch: baseData.default_branch, language: detectLanguages(root), cloneProtocol: protocol, pushOwner: identity.push.owner, pushRepo: identity.push.repo, baseRemote, originalBranch: branch, originalRemotes, baseSha };
}
