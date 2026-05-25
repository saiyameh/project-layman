import path from 'node:path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import type { LaymanConfig } from '../config.js';
import { runPreflight } from './preflight.js';
import { readContributionGuide } from './reader.js';
import { askAndAnalyzeIntent } from './intent.js';
import { buildDependencyGraph, findAffectedFiles } from './deps.js';
import { writeBrief } from './highlight.js';
import { suggestBranchName, runUndo, runWorkflow } from './workflow.js';

export async function runContributeFlow(
  config: LaymanConfig,
  rawPath: string | null,
  undo: boolean,
): Promise<void> {
  const repoPath = path.resolve(rawPath ?? process.cwd());

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
