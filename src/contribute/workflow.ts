import * as p from '@clack/prompts';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import simpleGit from 'simple-git';
import { Octokit } from '@octokit/rest';
import { callLLM } from './llm.js';
import type { RepoContext } from './preflight.js';
import type { ContributionGuide } from './reader.js';
import type { IntentResult } from './intent.js';
import type { LaymanConfig } from '../config.js';
import { printError, printInfo, printWarning } from '../ui/display.js';

const STATE_FILE = path.join(os.homedir(), '.layman', 'contribute-state.json');

type LastAction = 'issue' | 'branch' | 'commit' | 'push' | 'pr';

interface RepoState {
  lastAction: LastAction;
  branchName: string;
  defaultBranch: string;
  prNumber: number | null;
  issueNumber: number | null;
  upstreamOwner: string;
  upstreamRepo: string;
  forkOwner: string;
  timestamp: number;
}

interface ContributeState {
  [repoPath: string]: RepoState;
}

// ── state helpers ──────────────────────────────────────────────────────────

function loadState(): ContributeState {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as ContributeState;
  } catch { /* ignore */ }
  return {};
}

function saveState(state: ContributeState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* non-fatal */ }
}

function updateState(repoPath: string, patch: Partial<RepoState>): void {
  const state = loadState();
  state[repoPath] = { ...state[repoPath], ...patch, timestamp: Date.now() } as RepoState;
  saveState(state);
}

// ── UI helpers ──────────────────────────────────────────────────────────────

async function confirm(message: string): Promise<boolean> {
  const result = await p.confirm({ message: chalk.yellow(message) });
  if (p.isCancel(result)) { p.cancel(chalk.yellow('UGH. CAVE PERSON LEAVE. BYE.')); process.exit(0); }
  return result as boolean;
}

function cancelGuard<T>(value: T | symbol): T {
  if (p.isCancel(value)) { p.cancel(chalk.yellow('UGH. CAVE PERSON LEAVE. BYE.')); process.exit(0); }
  return value as T;
}

// ── Fix 1: issue step ───────────────────────────────────────────────────────

interface IssueHit { number: number; title: string; state: string; url: string }

async function searchIssues(
  octokit: Octokit,
  owner: string,
  repo: string,
  keywords: string[],
): Promise<IssueHit[]> {
  try {
    const q = `repo:${owner}/${repo} is:issue ${keywords.slice(0, 3).join(' ')}`;
    const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 5 });
    return data.items.map(i => ({ number: i.number, title: i.title, state: i.state, url: i.html_url }));
  } catch { return []; }
}

async function handleIssueStep(
  octokit: Octokit,
  ctx: RepoContext,
  intent: IntentResult,
  guide: ContributionGuide,
): Promise<number | null> {
  const hits = await searchIssues(octokit, ctx.upstreamOwner, ctx.upstreamRepo, intent.keywords);

  if (hits.length > 0) {
    printInfo('UGH. FOUND SIMILAR ISSUES — CHECK BEFORE CREATING NEW ONE:');
    for (const h of hits) {
      console.log(chalk.dim(`  #${h.number}: ${h.title} [${h.state}]  ${h.url}`));
    }
  } else {
    printInfo('UGH. NO EXISTING ISSUES FOUND. FRESH GROUND.');
  }

  const options = [
    ...(hits.length > 0 ? [{ value: 'link', label: 'Link existing issue', hint: 'enter the issue number' }] : []),
    { value: 'create', label: 'Create new issue' },
    { value: 'skip',   label: guide.issueRequired ? 'Skip (not recommended — this repo requires an issue)' : 'Skip' },
  ];

  const msg = guide.issueRequired
    ? 'UGH. THIS REPO NEEDS ISSUE FIRST. WHAT DO?'
    : 'UGH. WANT TO LINK OR CREATE ISSUE?';

  const choice = cancelGuard(await p.select({ message: chalk.yellow(msg), options }));

  if (choice === 'link') {
    const numStr = cancelGuard(await p.text({
      message: chalk.yellow('UGH. ENTER ISSUE NUMBER:'),
      validate: v => { if (!v || isNaN(parseInt(v))) return 'UGH. NEED A NUMBER.'; },
    }));
    return parseInt(numStr as string, 10);
  }

  if (choice === 'create') {
    try {
      const { data } = await octokit.issues.create({
        owner: ctx.upstreamOwner,
        repo: ctx.upstreamRepo,
        title: intent.raw.slice(0, 80),
        body: `## Description\n\n${intent.raw}\n\n*Created via project-layman*`,
      });
      printInfo(`UGH. CREATED ISSUE #${data.number}: ${data.html_url}`);
      return data.number;
    } catch (err) {
      printError(`UGH. COULD NOT CREATE ISSUE: ${(err as Error).message}`);
      return null;
    }
  }

  return null; // skip
}

// ── CI polling ──────────────────────────────────────────────────────────────

async function pollCIChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  prUrl: string,
): Promise<void> {
  const s = p.spinner();
  s.start('UGH. WAITING FOR CAVE SPIRITS (CI)...');
  const MAX_POLLS = 20;
  const INTERVAL_MS = 15_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 5_000 : INTERVAL_MS));
    try {
      const { data } = await octokit.checks.listForRef({ owner, repo, ref });
      const runs = data.check_runs;
      if (runs.length === 0) { s.message('UGH. CAVE SPIRITS NOT YET ARRIVED...'); continue; }

      const running = runs.filter(r => r.status !== 'completed').length;
      const passed  = runs.filter(r => r.conclusion === 'success').length;
      const failed  = runs.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out').length;

      s.message(`UGH. CAVE SPIRITS... ${running} running, ${passed} passed, ${failed} failed`);

      if (running === 0) {
        if (failed > 0) {
          s.stop(chalk.red(`UGH. CAVE SPIRITS ANGRY. ${failed} CHECK(S) FAILED.`));
          printWarning(`CHECK GITHUB: ${prUrl}`);
        } else {
          s.stop(chalk.green('UGH. CAVE SPIRITS HAPPY. ALL GREEN.'));
        }
        return;
      }
    } catch { /* keep polling */ }
  }
  s.stop('UGH. CI STILL RUNNING. CHECK GITHUB:');
  printInfo(prUrl);
}

// ── LLM helpers ─────────────────────────────────────────────────────────────

export async function suggestBranchName(
  intent: IntentResult,
  guide: ContributionGuide,
  config: LaymanConfig,
): Promise<string> {
  const conventionHint = guide.branchConvention ? `Follow this branch naming convention: ${guide.branchConvention}.` : '';
  const prompt = `Generate a git branch name for: "${intent.raw}". ${conventionHint} Rules: lowercase, hyphens only, 3-50 chars, start with feat/ fix/ docs/ chore/ as appropriate. Return ONLY the branch name.`;
  try {
    const result = (await callLLM(config, prompt, 60)).trim().replace(/[`'"]/g, '');
    if (/^[a-z][a-z0-9/_-]{2,49}$/.test(result) && !/[-/_]{2}/.test(result)) return result;
  } catch { /* fall through */ }
  const slug = intent.keywords.slice(0, 4).join('-').replace(/[^a-z0-9-]/g, '') || 'contribution';
  return `feat/${slug}`;
}

export async function suggestCommitMessage(
  intent: IntentResult,
  affectedFiles: string[],
  config: LaymanConfig,
): Promise<string> {
  const topFiles = affectedFiles.slice(0, 3).join(', ') || 'unknown';
  const prompt = `Write a conventional commit message for: "${intent.raw}". Affected files: ${topFiles}. Format: type(scope): description. Max 72 chars. Return ONLY the commit message.`;
  try {
    const result = (await callLLM(config, prompt, 80)).trim().replace(/^["']|["']$/g, '');
    if (result.length >= 5 && result.length <= 72) return result;
  } catch { /* fall through */ }
  return `feat: ${intent.raw.slice(0, 65)}`;
}

// ── undo ────────────────────────────────────────────────────────────────────

export async function runUndo(repoPath: string, config: LaymanConfig): Promise<void> {
  const state = loadState();
  const entry = state[repoPath];

  if (!entry) { printError('UGH. NOTHING TO UNDO FOR THIS REPO.'); return; }

  const octokit = new Octokit({ auth: config.github_token, userAgent: 'project-layman' });
  const git = simpleGit(repoPath);
  printInfo(`UGH. UNDOING LAST ACTION: ${entry.lastAction.toUpperCase()}...`);

  switch (entry.lastAction) {
    case 'pr':
      if (entry.prNumber) {
        await octokit.pulls.update({
          owner: entry.upstreamOwner, repo: entry.upstreamRepo,
          pull_number: entry.prNumber, state: 'closed',
        });
        printInfo(`UGH. CLOSED PR #${entry.prNumber}.`);
        updateState(repoPath, { lastAction: 'push' });
        printInfo('UGH. RUN --undo AGAIN TO DELETE REMOTE BRANCH.');  // Fix 9
      }
      break;

    case 'push':
      await git.push(['origin', '--delete', entry.branchName]);
      printInfo(`UGH. DELETED REMOTE BRANCH ${entry.branchName}.`);
      updateState(repoPath, { lastAction: 'branch' });
      printInfo('UGH. RUN --undo AGAIN TO DELETE LOCAL BRANCH.');  // Fix 9
      break;

    case 'branch':
    case 'commit':
      await git.checkout(entry.defaultBranch ?? 'main');
      await git.deleteLocalBranch(entry.branchName, true);
      printInfo(`UGH. DELETED LOCAL BRANCH ${entry.branchName}. FULLY UNDONE.`);
      delete state[repoPath];
      saveState(state);
      break;

    case 'issue':
      if (entry.issueNumber) {
        await octokit.issues.update({
          owner: entry.upstreamOwner, repo: entry.upstreamRepo,
          issue_number: entry.issueNumber, state: 'closed',
        });
        printInfo(`UGH. CLOSED ISSUE #${entry.issueNumber}.`);
        delete state[repoPath];
        saveState(state);
      }
      break;
  }
}

// ── main workflow ────────────────────────────────────────────────────────────

const DANGEROUS_RE = /\.(env|key|pem|pfx|p12|jks|pkcs12|crt|cer)$|\.env[.\w]*$|secret|password|token|credential|private/i;

export async function runWorkflow(
  ctx: RepoContext,
  guide: ContributionGuide,
  intent: IntentResult,
  affectedFiles: string[],
  branchName: string,
  config: LaymanConfig,
): Promise<void> {
  const octokit = new Octokit({ auth: config.github_token, userAgent: 'project-layman' });
  const git = simpleGit(ctx.repoPath);

  // ── Step 1 & 2: Issue handling (Fix 1 — dedup with link/create/skip) ──────
  console.log(chalk.dim('\n── Step 1: Issues ──'));
  const issueNumber = await handleIssueStep(octokit, ctx, intent, guide);
  if (issueNumber !== null) {
    updateState(ctx.repoPath, {
      lastAction: 'issue', issueNumber, branchName,
      defaultBranch: ctx.defaultBranch,
      upstreamOwner: ctx.upstreamOwner, upstreamRepo: ctx.upstreamRepo,
      forkOwner: ctx.forkOwner, prNumber: null,
    });
  }

  // ── Step 3: Branch (Fix 2 — branch-exists check) ─────────────────────────
  console.log(chalk.dim('\n── Step 2: Branch ──'));
  let activeBranch = branchName;

  const localBranches = (await git.branchLocal()).all;
  if (localBranches.includes(activeBranch)) {
    const branchChoice = cancelGuard(await p.select({
      message: chalk.yellow(`UGH. BRANCH "${activeBranch}" ALREADY EXISTS. WHAT DO?`),
      options: [
        { value: 'continue', label: 'Continue on existing branch', hint: 'resume previous work' },
        { value: 'rename',   label: 'Use a new name',              hint: 'start fresh' },
      ],
    }));

    if (branchChoice === 'continue') {
      await git.checkout(activeBranch);
      printInfo(`UGH. CHECKED OUT EXISTING BRANCH ${activeBranch}.`);
    } else {
      const newName = cancelGuard(await p.text({
        message: chalk.yellow('UGH. ENTER NEW BRANCH NAME:'),
        defaultValue: `${activeBranch}-2`,
        validate: v => {
          if (!v?.trim()) return 'UGH. NEED A NAME.';
          if (!/^[a-z][a-z0-9/_-]{2,49}$/.test(v.trim()) || /[-/_]{2}/.test(v.trim())) return 'UGH. INVALID NAME (lowercase, hyphens, 3-50 chars).';
        },
      }));
      activeBranch = (newName as string).trim();
      await git.checkoutLocalBranch(activeBranch);
      printInfo(`UGH. CREATED BRANCH ${activeBranch}.`);
    }
  } else {
    const doBranch = await confirm(`UGH. CREATE BRANCH "${activeBranch}"?`);
    if (!doBranch) { printInfo('UGH. STOPPING. RUN AGAIN WHEN READY.'); return; }
    await git.checkoutLocalBranch(activeBranch);
    printInfo(`UGH. ON BRANCH ${activeBranch}. MAKE YOUR CHANGES NOW.`);
  }

  updateState(ctx.repoPath, {
    lastAction: 'branch', branchName: activeBranch,
    defaultBranch: ctx.defaultBranch,
    upstreamOwner: ctx.upstreamOwner, upstreamRepo: ctx.upstreamRepo,
    forkOwner: ctx.forkOwner, issueNumber, prNumber: null,
  });

  // ── Step 4: User makes changes ────────────────────────────────────────────
  console.log(chalk.dim('\n── Step 3: Make your changes ──'));
  cancelGuard(await p.text({
    message: chalk.yellow('UGH. EDIT YOUR FILES NOW. PRESS ENTER WHEN DONE.'),
    placeholder: '(press Enter to continue)',
  }));

  // ── Step 5: Stage (Fix 4 — preview + secrets, Fix 5 — empty staged retry) ─
  console.log(chalk.dim('\n── Step 4: Stage changes ──'));

  async function stageChanges(): Promise<boolean> {
    const preStatus = await git.status();
    const toStage = [
      ...preStatus.modified, ...preStatus.not_added,
      ...preStatus.created,  ...preStatus.deleted,
      ...preStatus.renamed.map(r => r.to),
    ];

    if (toStage.length === 0) {
      printWarning('UGH. NO CHANGES DETECTED.');
      return false;
    }

    // Show file list
    printInfo(`UGH. ${toStage.length} FILE(S) TO STAGE:`);
    for (const f of toStage.slice(0, 20)) console.log(chalk.dim(`  + ${f}`));
    if (toStage.length > 20) console.log(chalk.dim(`  ... and ${toStage.length - 20} more`));

    // Dangerous file check
    const dangerous = toStage.filter(f => DANGEROUS_RE.test(path.basename(f)));
    if (dangerous.length > 0) {
      printWarning('UGH. THESE FILES LOOK DANGEROUS (MAY CONTAIN SECRETS):');
      for (const f of dangerous) console.log(chalk.red(`  ⚠  ${f}`));
      const proceedAnyway = await confirm('UGH. STAGE ANYWAY?');
      if (!proceedAnyway) { printInfo('UGH. STOPPING. REMOVE SENSITIVE FILES FIRST.'); return false; }
    }

    const doAdd = await confirm(`UGH. STAGE ALL ${toStage.length} FILE(S)? (git add -A)`);
    if (!doAdd) { printInfo('UGH. STOPPING HERE.'); return false; }

    await git.add('-A');

    // Verify something was actually staged
    const afterStatus = await git.status();
    if (afterStatus.staged.length === 0) {
      printWarning('UGH. NOTHING STAGED. FILES MAY ALREADY BE TRACKED WITH NO DIFF.');
      return false;
    }

    return true;
  }

  let staged = await stageChanges();
  if (!staged) {
    // One retry after user makes more changes
    cancelGuard(await p.text({
      message: chalk.yellow('UGH. MAKE MORE CHANGES OR FIX ISSUE. PRESS ENTER TO TRY AGAIN.'),
      placeholder: '(press Enter)',
    }));
    staged = await stageChanges();
    if (!staged) { printError('UGH. STILL NOTHING TO STAGE. STOPPING.'); return; }
  }

  // ── Step 6: Commit (Fix 11 — editable commit message) ────────────────────
  console.log(chalk.dim('\n── Step 5: Commit ──'));
  const suggestedMsg = await suggestCommitMessage(intent, affectedFiles, config);
  const signLabel = guide.signOffRequired ? chalk.dim(' (will add --signoff)') : '';

  const editedMsg = cancelGuard(await p.text({
    message: chalk.yellow(`UGH. COMMIT MESSAGE — EDIT IF NEEDED:${signLabel}`),
    defaultValue: suggestedMsg,
    validate: v => {
      if (!v?.trim()) return 'UGH. NEED A MESSAGE.';
      if (v.trim().length > 72) return `UGH. TOO LONG (${v.trim().length}/72 chars).`;
    },
  }));
  const finalCommitMsg = (editedMsg as string).trim();

  const commitOptions = guide.signOffRequired ? { '--signoff': null } : undefined;
  const commitResult = await git.commit(finalCommitMsg, undefined, commitOptions);
  const commitSha = commitResult.commit;
  updateState(ctx.repoPath, { lastAction: 'commit', branchName: activeBranch });
  printInfo(`UGH. COMMITTED: ${commitSha.slice(0, 8)}`);

  // ── Step 7: Push ──────────────────────────────────────────────────────────
  console.log(chalk.dim('\n── Step 6: Push ──'));
  const doPush = await confirm(`UGH. PUSH "${activeBranch}" TO YOUR FORK?`);
  if (!doPush) { printInfo('UGH. STOPPING HERE.'); return; }

  await git.push('origin', activeBranch, { '--set-upstream': null });
  updateState(ctx.repoPath, { lastAction: 'push' });
  printInfo('UGH. PUSHED TO FORK.');

  // ── Step 8: PR (Fix 6 — existing PR, Fix 10 — prTargetBranch) ────────────
  console.log(chalk.dim('\n── Step 7: Pull Request ──'));

  // Fix 10: honour CONTRIBUTING-specified target branch
  const prBase = guide.prTargetBranch ?? ctx.defaultBranch;
  if (guide.prTargetBranch && guide.prTargetBranch !== ctx.defaultBranch) {
    printInfo(`UGH. CONTRIBUTING GUIDE SAYS TARGET BRANCH IS "${prBase}" (NOT "${ctx.defaultBranch}").`);
  }

  const briefPath = path.join(ctx.repoPath, 'LAYMAN_BRIEF.md');
  let prBody = `## Summary\n\n${intent.raw}\n\n## Critical Points\n\n${intent.checklist}`;
  try { prBody = fs.readFileSync(briefPath, 'utf-8'); } catch { /* use fallback */ }
  if (issueNumber) prBody += `\n\nCloses #${issueNumber}`;

  let prUrl = '';
  let prNumber: number | null = null;

  // Fix 6: check for existing open PR first
  try {
    const existingPRs = await octokit.pulls.list({
      owner: ctx.upstreamOwner, repo: ctx.upstreamRepo,
      head: `${ctx.forkOwner}:${activeBranch}`, state: 'open',
    });
    if (existingPRs.data.length > 0) {
      const existing = existingPRs.data[0];
      prUrl = existing.html_url;
      prNumber = existing.number;
      printInfo(`UGH. PR ALREADY OPEN: ${prUrl}`);
      const updateDesc = await confirm('UGH. UPDATE PR DESCRIPTION WITH LATEST BRIEF?');
      if (updateDesc) {
        await octokit.pulls.update({
          owner: ctx.upstreamOwner, repo: ctx.upstreamRepo,
          pull_number: existing.number, body: prBody,
        });
        printInfo('UGH. PR DESCRIPTION UPDATED.');
      }
    }
  } catch { /* non-fatal */ }

  if (!prUrl) {
    const doPR = await confirm(`UGH. OPEN PR TO ${ctx.upstreamOwner}/${ctx.upstreamRepo}:${prBase}?`);
    if (!doPR) { printInfo('UGH. STOPPING HERE.'); return; }

    try {
      const { data } = await octokit.pulls.create({
        owner: ctx.upstreamOwner, repo: ctx.upstreamRepo,
        title: finalCommitMsg, body: prBody,
        head: `${ctx.forkOwner}:${activeBranch}`, base: prBase,
      });
      prUrl = data.html_url;
      prNumber = data.number;
      updateState(ctx.repoPath, { lastAction: 'pr', prNumber });
      printInfo(`UGH. PR CREATED: ${prUrl}`);
    } catch (err) {
      printError(`UGH. COULD NOT CREATE PR: ${(err as Error).message}`);
      return;
    }
  } else if (prNumber !== null) {
    updateState(ctx.repoPath, { lastAction: 'pr', prNumber });
  }

  // ── Step 9: CI polling ────────────────────────────────────────────────────
  console.log(chalk.dim('\n── Step 8: CI checks ──'));
  if (commitSha) {
    await pollCIChecks(octokit, ctx.upstreamOwner, ctx.upstreamRepo, commitSha, prUrl);
  }
}
