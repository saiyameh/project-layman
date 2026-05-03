import { Octokit } from '@octokit/rest';
import simpleGit from 'simple-git';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';
import type { GitHubRepo } from './describers/index.js';
import { printError, printInfo, printWarning } from './ui/display.js';
import { askOverwriteRepo } from './ui/prompts.js';

let cachedUsername: string | null = null;

function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: 'project-layman' });
}

function expandHome(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function sanitizeSearchQuery(query: string): string {
  return query.replace(/["]/g, '');
}

export async function getAuthenticatedUser(token: string): Promise<string> {
  if (cachedUsername) return cachedUsername;
  const octokit = createOctokit(token);
  const { data } = await octokit.rest.users.getAuthenticated();
  cachedUsername = data.login;
  return data.login;
}

export async function searchRepos(
  token: string,
  query: string,
  count: number,
  sort: 'stars' | 'forks' | 'updated' = 'stars',
  language?: string,
): Promise<GitHubRepo[]> {
  const octokit = createOctokit(token);
  const clampedCount = Math.min(count, 100);

  let q = sanitizeSearchQuery(query);
  if (language) {
    q += ` language:${language}`;
  }

  try {
    const { data } = await octokit.rest.search.repos({
      q,
      sort,
      order: 'desc',
      per_page: clampedCount,
    });

    return data.items.map((item, index) => ({
      rank: index + 1,
      name: item.name,
      full_name: item.full_name,
      owner: item.owner?.login || '',
      description: item.description || null,
      stars: item.stargazers_count || 0,
      forks: item.forks_count || 0,
      language: item.language || null,
      url: item.html_url,
      topics: item.topics || [],
    }));
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status === 403) {
      throw new Error('UGH. GITHUB SAY SLOW DOWN. WAIT BIT AND TRY AGAIN.');
    }
    if (error.status === 401) {
      throw new Error('UGH. GITHUB TOKEN NO WORK. RUN layman --reset TO FIX.');
    }
    throw new Error(`UGH. SEARCH BROKE: ${error.message || 'unknown error'}`);
  }
}

export async function forkRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<string> {
  const octokit = createOctokit(token);
  const username = await getAuthenticatedUser(token);

  try {
    await octokit.rest.repos.createFork({ owner, repo });
  } catch (err: unknown) {
    const error = err as { status?: number };
    if (error.status !== 202) {
      throw new Error('UGH. COULD NOT COPY REPO. CHECK TOKEN HAVE FORK PERMISSION.');
    }
  }

  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await octokit.rest.repos.get({ owner: username, repo });
      break;
    } catch {
      if (i === maxAttempts - 1) {
        printWarning('Fork taking long. Proceeding anyway...');
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return username;
}

export async function starRepo(token: string, owner: string, repo: string): Promise<void> {
  const octokit = createOctokit(token);
  try {
    await octokit.rest.activity.starRepoForAuthenticatedUser({ owner, repo });
  } catch {
    throw new Error(`UGH. COULD NOT STAR ${repo}. CHECK TOKEN PERMISSIONS.`);
  }
}

export async function fetchReadme(token: string, owner: string, repo: string): Promise<string> {
  const octokit = createOctokit(token);
  try {
    const { data } = await octokit.rest.repos.getReadme({ owner, repo });
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    const lines = content.split('\n');
    if (lines.length > 60) {
      return lines.slice(0, 60).join('\n') + '\n\n... (truncated, see full README on GitHub)';
    }
    return content;
  } catch {
    return 'UGH. NO README FOUND IN THIS CAVE.';
  }
}

export async function cloneRepo(
  token: string,
  repoName: string,
  owner: string,
  workspaceDir: string,
  cloneProtocol: 'https' | 'ssh',
  isInteractive: boolean = true,
): Promise<string | null> {
  const expandedDir = expandHome(workspaceDir);
  const destPath = path.join(expandedDir, repoName);

  if (!fs.existsSync(expandedDir)) {
    fs.mkdirSync(expandedDir, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    if (!isInteractive) {
      return null;
    }
    const choice = await askOverwriteRepo(repoName);

    if (choice === 'skip') {
      printInfo(`Skipping ${repoName}`);
      return destPath;
    }

    if (choice === 'pull') {
      const s = p.spinner();
      s.start(`UGH. UPDATING ${repoName}...`);
      try {
        const git = simpleGit(destPath);
        await git.pull();
        s.stop(`${repoName} updated`);
        return destPath;
      } catch {
        s.stop('Pull failed');
        printError('UGH. GIT PULL BROKE. CHECK INTERNET AND TRY AGAIN.');
        return destPath;
      }
    }

    fs.rmSync(destPath, { recursive: true, force: true });
  }

  const username = await getAuthenticatedUser(token);
  let cloneUrl: string;
  if (cloneProtocol === 'ssh') {
    cloneUrl = `git@github.com:${username}/${repoName}.git`;
  } else {
    cloneUrl = `https://github.com/${username}/${repoName}.git`;
  }

  try {
    const git = simpleGit();
    await git.clone(cloneUrl, destPath);
    return destPath;
  } catch {
    throw new Error('UGH. GIT CLONE BROKE. CHECK INTERNET AND TRY AGAIN.');
  }
}
