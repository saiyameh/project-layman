import path from 'node:path';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import simpleGit from 'simple-git';
import type { LaymanConfig } from '../config.js';
import { runPreflight } from './preflight.js';
import { readContributionGuide } from './reader.js';
import { askAndAnalyzeIntent } from './intent.js';
import { buildDependencyGraph, findAffectedFiles } from './deps.js';
import { writeBrief } from './highlight.js';
import { suggestBranchName, runUndo, runWorkflow } from './workflow.js';
import { printInfo, printError } from '../ui/display.js';

async function resolveRepoPath(rawPath: string | null, config: LaymanConfig): Promise<string> {
  if (!rawPath) return process.cwd();

  const githubUrl = rawPath.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
  const sshUrl    = rawPath.match(/^git@github\.com:([^/]+)\/([^/.#?]+)/);
  const match = githubUrl ?? sshUrl;

  if (match) {
    const owner = match[1];
    const repo  = match[2].replace(/\.git$/, '');
    const destPath = path.join(config.workspace_dir, repo);

    if (fs.existsSync(destPath)) {
      printInfo(`UGH. ${repo} ALREADY IN CAVE: ${destPath}`);
      return destPath;
    }

    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    const s = p.spinner();
    s.start(`UGH. DRAGGING ${repo} TO CAVE...`);
    try {
      await simpleGit().clone(cloneUrl, destPath);
      s.stop(`Cloned ${owner}/${repo} → ${destPath}`);
      return destPath;
    } catch (err) {
      s.stop('Clone failed');
      printError(`UGH. CANNOT CLONE: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  return path.resolve(rawPath);
}

export async function runContributeFlow(
  config: LaymanConfig,
  rawPath: string | null,
  undo: boolean,
): Promise<void> {
  const repoPath = await resolveRepoPath(rawPath, config);

  if (undo) {
    await runUndo(repoPath, config);
    return;
  }

  p.intro(chalk.bold.yellow('UGH. CONTRIBUTION MODE. FOLLOW STEPS.'));

  // Stage 0 — pre-flight
  const ctx = await runPreflight(repoPath, config);

  // Stage 1 — read contribution guide
  const guide = await readContributionGuide(ctx, config);

  // Stage 2 — intent + checklist (also extracts keywords for Stage 3)
  const intent = await askAndAnalyzeIntent(guide, ctx, config);

  // Stage 3 — dependency graph + file ranking
  const graphs = await buildDependencyGraph(ctx);
  const affectedFiles = findAffectedFiles(graphs, intent.keywords);

  // Suggest branch name via LLM before writing brief
  const branchName = await suggestBranchName(intent, guide, config);

  // Stage 4 — write LAYMAN_BRIEF.md and open in editor
  await writeBrief(ctx.repoPath, intent, guide, affectedFiles, branchName, config.editor_command);

  // Stage 5 — GitHub workflow
  await runWorkflow(ctx, guide, intent, affectedFiles, branchName, config);

  p.outro(chalk.bold.yellow('UGH. CONTRIBUTION DONE. CAVE PERSON PROUD.'));
}
