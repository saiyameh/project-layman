import path from 'node:path';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { Octokit } from '@octokit/rest';
import simpleGit from 'simple-git';
import { forkRepo, getAuthenticatedUser } from '../github.js';
import type { LaymanConfig } from '../config.js';
import { printError, printInfo } from '../ui/display.js';

export interface RepoContext {
  repoPath: string;
  upstreamOwner: string;
  upstreamRepo: string;
  forkOwner: string;
  defaultBranch: string;
  language: string[];
  cloneProtocol: 'https' | 'ssh';
}

function parseGitUrl(url: string): { owner: string; repo: string } | null {
  const ssh = url.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

function detectLanguages(repoPath: string): string[] {
  const indicators: { file: string; lang: string }[] = [
    { file: 'package.json', lang: 'js' },
    { file: 'go.mod', lang: 'go' },
    { file: 'Cargo.toml', lang: 'rust' },
    { file: 'requirements.txt', lang: 'python' },
    { file: 'setup.py', lang: 'python' },
    { file: 'pyproject.toml', lang: 'python' },
  ];

  const langs: string[] = [];
  const add = (lang: string) => { if (!langs.includes(lang)) langs.push(lang); };

  for (const { file, lang } of indicators) {
    if (fs.existsSync(path.join(repoPath, file))) add(lang);
  }

  if (langs.length === 0) {
    try {
      for (const entry of fs.readdirSync(repoPath, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const sub = path.join(repoPath, entry.name);
        for (const { file, lang } of indicators) {
          if (fs.existsSync(path.join(sub, file))) add(lang);
        }
      }
    } catch { /* ignore */ }
  }

  return langs.length > 0 ? langs : ['unknown'];
}

export async function runPreflight(repoPath: string, config: LaymanConfig): Promise<RepoContext> {
  const resolved = path.resolve(repoPath);

  if (!fs.existsSync(resolved)) {
    printError(`UGH. PATH NOT EXIST: ${resolved}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(resolved, '.git'))) {
    printError(`UGH. NOT A GIT REPO: ${resolved}`);
    process.exit(1);
  }

  // LLM check
  const { llm } = config;
  const llmReady = llm.provider !== null && (
    llm.provider === 'ollama' ||
    (llm.provider === 'openai-compatible' && llm.base_url !== null) ||
    llm.api_key !== null
  );
  if (!llmReady) {
    printError('UGH. NEED BRAIN (LLM) FOR THIS. RUN layman --reset TO SET UP LLM.');
    process.exit(1);
  }

  const git = simpleGit(resolved);
  const remotes = await git.getRemotes(true);

  if (remotes.length === 0) {
    printError('UGH. NO GIT REMOTES FOUND. IS THIS A REAL REPO?');
    process.exit(1);
  }

  const originRemote = remotes.find(r => r.name === 'origin');
  const upstreamRemote = remotes.find(r => r.name === 'upstream');

  const cloneProtocol: 'https' | 'ssh' = (originRemote?.refs.fetch ?? '').startsWith('git@') ? 'ssh' : 'https';

  const forkOwner = await getAuthenticatedUser(config.github_token);
  const octokit = new Octokit({ auth: config.github_token, userAgent: 'project-layman' });

  let upstreamOwner: string;
  let upstreamRepo: string;

  const originParsed = originRemote ? parseGitUrl(originRemote.refs.fetch) : null;

  if (originParsed && originParsed.owner === forkOwner) {
    // origin already points to the user's fork
    upstreamRepo = originParsed.repo;

    if (upstreamRemote) {
      const up = parseGitUrl(upstreamRemote.refs.fetch);
      upstreamOwner = up?.owner ?? originParsed.owner;
    } else {
      // Try to find parent via API
      try {
        const { data } = await octokit.repos.get({ owner: forkOwner, repo: originParsed.repo });
        if (data.fork && data.parent) {
          upstreamOwner = data.parent.owner.login;
          const parentUrl = cloneProtocol === 'ssh'
            ? `git@github.com:${upstreamOwner}/${upstreamRepo}.git`
            : `https://github.com/${upstreamOwner}/${upstreamRepo}.git`;
          await git.addRemote('upstream', parentUrl);
          printInfo(`UGH. ADDED UPSTREAM REMOTE: ${upstreamOwner}/${upstreamRepo}.`);
        } else {
          printError('UGH. CANNOT DETERMINE UPSTREAM REPO. ADD upstream REMOTE MANUALLY: git remote add upstream <url>');
          process.exit(1);
        }
      } catch {
        printError('UGH. CANNOT DETERMINE UPSTREAM REPO. ADD upstream REMOTE MANUALLY: git remote add upstream <url>');
        process.exit(1);
      }
    }
  } else {
    // origin points to upstream — check/create fork
    const ref = originRemote ?? remotes[0];
    const parsed = parseGitUrl(ref.refs.fetch);
    if (!parsed) {
      printError(`UGH. CANNOT PARSE GIT URL: ${ref.refs.fetch}`);
      process.exit(1);
    }
    upstreamOwner = parsed.owner;
    upstreamRepo = parsed.repo;

    try {
      await octokit.repos.get({ owner: forkOwner, repo: upstreamRepo });
      // Fork exists — ensure upstream remote
      if (!upstreamRemote) {
        const upUrl = cloneProtocol === 'ssh'
          ? `git@github.com:${upstreamOwner}/${upstreamRepo}.git`
          : `https://github.com/${upstreamOwner}/${upstreamRepo}.git`;
        await git.addRemote('upstream', upUrl);
        printInfo('UGH. ADDED UPSTREAM REMOTE.');
      }
    } catch {
      // Fork doesn't exist — create it
      printInfo(`UGH. FORKING ${upstreamOwner}/${upstreamRepo}...`);
      await forkRepo(config.github_token, upstreamOwner, upstreamRepo);

      const forkUrl = cloneProtocol === 'ssh'
        ? `git@github.com:${forkOwner}/${upstreamRepo}.git`
        : `https://github.com/${forkOwner}/${upstreamRepo}.git`;
      const upUrl = cloneProtocol === 'ssh'
        ? `git@github.com:${upstreamOwner}/${upstreamRepo}.git`
        : `https://github.com/${upstreamOwner}/${upstreamRepo}.git`;

      await git.remote(['set-url', 'origin', forkUrl]);
      await git.addRemote('upstream', upUrl);
      printInfo('UGH. FORK CREATED. REMOTES SET UP. GOOD.');
    }
  }

  // Detect default branch + archived/disabled check (Fix 7)
  let defaultBranch = 'main';
  try {
    const { data } = await octokit.repos.get({ owner: upstreamOwner, repo: upstreamRepo });
    if (data.archived) {
      printError(`UGH. ${upstreamOwner}/${upstreamRepo} IS ARCHIVED. NO PRs ACCEPTED. FIND ACTIVE FORK.`);
      process.exit(1);
    }
    if (data.disabled) {
      printError(`UGH. ${upstreamOwner}/${upstreamRepo} IS DISABLED. CANNOT CONTRIBUTE.`);
      process.exit(1);
    }
    defaultBranch = data.default_branch;
  } catch (err) {
    const msg = (err as { message?: string }).message ?? '';
    if (msg.includes('exit')) throw err; // re-throw process.exit calls
    /* keep 'main' on network errors */
  }

  // Stale fork sync check (Fix 3)
  try {
    await git.fetch('upstream');
    const behindRaw = (await git.raw(['rev-list', '--count', `HEAD..upstream/${defaultBranch}`])).trim();
    const behind = parseInt(behindRaw, 10);
    if (!isNaN(behind) && behind > 0) {
      printInfo(`UGH. YOUR FORK IS ${behind} COMMIT(S) BEHIND UPSTREAM.`);
      const doSync = await p.confirm({ message: chalk.yellow('UGH. SYNC FORK WITH UPSTREAM NOW? (STRONGLY RECOMMENDED)') });
      if (!p.isCancel(doSync) && doSync) {
        const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
        if (current !== defaultBranch) await git.checkout(defaultBranch);
        await git.merge([`upstream/${defaultBranch}`, '--ff-only']);
        await git.push('origin', defaultBranch);
        printInfo(`UGH. FORK SYNCED. ${behind} COMMITS CAUGHT UP. GOOD.`);
        if (current !== defaultBranch) await git.checkout(current);
      }
    }
  } catch { /* non-fatal — upstream branch may not exist yet */ }

  return {
    repoPath: resolved,
    upstreamOwner,
    upstreamRepo,
    forkOwner,
    defaultBranch,
    language: detectLanguages(resolved),
    cloneProtocol,
  };
}
