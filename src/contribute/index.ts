import path from 'node:path';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import simpleGit from 'simple-git';
import { runLLMSetup, type LaymanConfig } from '../config.js';
import { checkLLMConnection, getLLMConfigError } from './llm.js';
import { runPreflight, parseGitUrl, assertSafeWorktree } from './preflight.js';
import { readContributionGuide } from './reader.js';
import { interpretPolicy, hasSecurityPause } from './policy.js';
import { askAndAnalyzeIntent } from './intent.js';
import { buildDependencyGraph, findAffectedFiles } from './deps.js';
import { writeBrief } from './highlight.js';
import { suggestBranchName, runUndo, runWorkflow, showStatus, cleanupContribution, type WorkflowOperation } from './workflow.js';
import { newSession, findSession, saveSession, type ContributionSession } from './state.js';
import { guard } from './submission.js';
import { printContributionPanel } from '../ui/contribution.js';

export interface ContributionOptions { operation?: WorkflowOperation; issue?: string; fresh?: boolean }

export async function resolveRepoPath(rawPath: string | null, config: LaymanConfig): Promise<string> {
  if (!rawPath) return process.cwd();
  const target = rawPath.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/issues\/\d+)?\/?$/i)
    ?? rawPath.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (!target) {
    if (/^[\w+.-]+:\/\//.test(rawPath) || rawPath.startsWith('git@')) throw new Error('Use a GitHub repo URL, issue URL, or local folder.');
    return path.resolve(rawPath);
  }
  const [, owner, repo] = target;
  if ([owner, repo].some(value => value === '.' || value === '..')) throw new Error('Invalid repository URL.');
  const destination = path.join(config.workspace_dir, owner, repo);
  if (fs.existsSync(destination)) {
    const git = simpleGit(destination);
    if ((await git.revparse(['--show-toplevel'])).trim() !== fs.realpathSync(destination)) throw new Error('The clone destination is not a repository root.');
    const remotes = await git.getRemotes(true);
    const identities = remotes.map(remote => parseGitUrl(remote.refs.fetch));
    if (!identities.some(identity => identity?.owner.toLowerCase() === owner.toLowerCase() && identity.repo.toLowerCase() === repo.toLowerCase())) throw new Error('This clone destination belongs to another repository. Keep it and choose a new workspace.');
    return destination;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const cloneURL = config.clone_protocol === 'ssh' ? `git@github.com:${owner}/${repo}.git` : `https://github.com/${owner}/${repo}.git`;
  try { await simpleGit().clone(cloneURL, destination); }
  catch { throw new Error('Clone failed. Configure Git transport access separately from the GitHub API token.'); }
  return destination;
}

export async function runContributeFlow(config: LaymanConfig, rawPath: string | null, undo: boolean, options: ContributionOptions = {}): Promise<void> {
  const operation = options.operation ?? 'prepare';
  if (!undo && operation !== 'status' && operation !== 'cleanup') {
    if (getLLMConfigError(config.llm)) config = await runLLMSetup(config);
    else {
      const spinner = p.spinner();
      spinner.start('Connect the model. Check the provider and model.');
      try { await checkLLMConnection(config); spinner.stop('Model ready.'); }
      catch (error) { spinner.stop('Model unavailable.'); throw error; }
    }
  }
  if ((undo || operation === 'status' || operation === 'cleanup') && rawPath && /^(?:https?:|git@)/.test(rawPath)) throw new Error('Recovery and status need an existing local repository.');
  const repoPath = await resolveRepoPath(rawPath, config);
  if (undo) { await runUndo(repoPath, config); return; }
  const git = simpleGit(repoPath);
  const root = fs.realpathSync((await git.revparse(['--show-toplevel'])).trim());
  const branch = (await git.branchLocal()).current;
  let session = options.fresh ? undefined : findSession(root, branch);
  if (operation === 'status' || operation === 'cleanup') {
    if (!session) throw new Error('No saved contribution. Run layman --contribute to prepare one.');
    if (operation === 'status') await showStatus(session, config, true);
    else await cleanupContribution(session, config);
    return;
  }
  if (!session && operation !== 'prepare') throw new Error('No saved contribution. Run layman --contribute to prepare one.');
  if (!session) {
    await assertSafeWorktree(root);
    const remotes = Object.fromEntries((await git.getRemotes(true)).map(remote => [remote.name, remote.refs.fetch]));
    session = newSession(root, branch, remotes, (await git.revparse(['HEAD'])).trim());
    saveSession(session);
  }
  try {
    if (!session.ctx) {
      session.ctx = await runPreflight(root, config);
      session.baseSha = session.ctx.baseSha!;
      saveSession(session);
    } else if (!session.branch.startsWith('pending-') && session.stage !== 'preparing') {
      const verified = await runPreflight(root, config, { resume: true });
      if (verified.upstreamOwner.toLowerCase() !== session.ctx.upstreamOwner.toLowerCase() || verified.upstreamRepo.toLowerCase() !== session.ctx.upstreamRepo.toLowerCase() || verified.pushOwner?.toLowerCase() !== session.ctx.pushOwner?.toLowerCase() || verified.pushRepo?.toLowerCase() !== session.ctx.pushRepo?.toLowerCase()) throw new Error('Repository identity changed. Saved work remains; restore the verified remotes.');
      session.ctx = { ...verified, originalBranch: session.originalBranch, originalRemotes: session.originalRemotes };
    }
    const ctx = session.ctx;
    let discovered = await readContributionGuide(ctx, config);
    if (session.guide?.policyHash !== discovered.policyHash) {
      session.acknowledgments = {};
      session.checks = [];
      session.preview = undefined;
      session.guide = discovered;
      saveSession(session);
    } else if (session.guide) discovered = session.guide;
    if (!session.rawIntent) {
      const raw = guard(await p.text({ message: 'Describe the change you will make.', validate: value => !value.trim() ? 'Describe the change.' : undefined }));
      session.rawIntent = raw.trim();
      saveSession(session);
    }
    if (!session.intent) {
      session.intent = await askAndAnalyzeIntent(discovered, ctx, config, session.rawIntent);
      saveSession(session);
    }
    if (session.policyInterpretedHash !== discovered.policyHash) {
      discovered = await interpretPolicy(discovered, config, session.intent);
      session.policyInterpretedHash = discovered.policyHash;
    }
    session.guide = discovered;
    saveSession(session);
    printContributionPanel(session, 2, 'Layman will prepare the contribution work area.');
    // Prose rules are unknown until a contributor action or a recorded check verifies them.
    if (hasSecurityPause(discovered, session.intent)) throw new Error('Use the repository private security channel. Normal issue publication is paused.');
    if (discovered.prTargetBranch && discovered.prTargetBranch !== ctx.defaultBranch) {
      await git.raw(['check-ref-format', '--branch', discovered.prTargetBranch]);
      await git.fetch(ctx.baseRemote ?? 'upstream', discovered.prTargetBranch);
      ctx.baseSha = (await git.revparse([`${ctx.baseRemote ?? 'upstream'}/${discovered.prTargetBranch}`])).trim();
    }
    let baseSha = session.baseSha;
    if ((await git.branchLocal()).current === session.branch) {
      try { baseSha = (await git.raw(['merge-base', 'HEAD', ctx.baseSha!])).trim(); }
      catch { throw new Error('No common target revision. Preserve work and inspect branch history.'); }
    } else if (session.stage === 'preparing') baseSha = ctx.baseSha!;
    if (session.baseSha !== baseSha) {
      session.baseSha = baseSha;
      saveSession(session);
    }
    if (session.branch.startsWith('pending-')) {
      session.branch = await suggestBranchName(session.intent, discovered, config);
      await git.raw(['check-ref-format', '--branch', session.branch]);
      if (session.branch === ctx.defaultBranch || session.branch === discovered.prTargetBranch) throw new Error('The contribution branch must differ from the target branch.');
      saveSession(session);
    }
    if (!session.briefPath) {
      let files: string[] = [];
      try { files = findAffectedFiles(await buildDependencyGraph(ctx), session.intent.keywords); }
      catch { console.log('Prepare work. File guidance is unavailable. You can continue.'); }
      session.briefPath = await writeBrief(root, session.intent, discovered, files, session.branch, config.editor_command);
      saveSession(session);
    }
    let next: WorkflowOperation = operation;
    if (operation === 'resume') next = guard(await p.select({ message: 'Choose the next step.', options: [
      { value: 'check', label: 'Check work: run trusted checks' }, { value: 'submit', label: 'Review work: inspect and publish' },
      { value: 'prepare', label: 'Prepare work: save and return to code' },
    ] })) as WorkflowOperation;
    const outcome = await runWorkflow(ctx, discovered, session.intent, [], session.branch, config, session, next, options.issue || (rawPath?.includes('/issues/') ? rawPath : undefined));
    if (outcome === 'paused') { session.stage = 'paused'; saveSession(session); }
    p.outro(`Contribution ${outcome}. Saved branch: ${session.branch}.`);
  } catch (error) {
    session.error = error instanceof Error ? error.message : 'The contribution stopped.';
    // The last durable operation remains pending so a retry can reconcile its outcome.
    saveSession(session);
    throw error;
  }
}
