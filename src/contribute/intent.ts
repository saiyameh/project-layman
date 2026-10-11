import * as p from '@clack/prompts';
import chalk from 'chalk';
import { Octokit } from '@octokit/rest';
import { callLLM, assertSafeModelContext } from './llm.js';
import { CLI_EXPLANATION_RULES } from '../ui/caveman.js';
import type { ContributionGuide } from './reader.js';
import type { RepoContext } from './preflight.js';
import type { LaymanConfig } from '../config.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'to', 'in', 'of', 'and', 'for', 'with',
  'that', 'this', 'fix', 'add', 'make', 'i', 'want', 'need', 'would',
  'like', 'can', 'should', 'will', 'my', 'we', 'our', 'it', 'be',
  'are', 'was', 'not', 'but', 'have', 'has', 'had', 'do', 'did',
]);

export interface IntentResult {
  raw: string;
  keywords: string[];
  checklist: string;
}

export function extractKeywords(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w)),
  )];
}

async function fetchSimilarPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  keywords: string[],
): Promise<string> {
  try {
    const q = `repo:${owner}/${repo} is:pr is:merged ${keywords.slice(0, 3).join(' ')}`;
    const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 3 });
    if (data.items.length === 0) return '';
    return '\n\nSimilar merged PRs for context:\n' +
      data.items.map(pr => `- #${pr.number}: ${pr.title}`).join('\n');
  } catch {
    return '';
  }
}

export async function askAndAnalyzeIntent(
  guide: ContributionGuide,
  ctx: RepoContext,
  config: LaymanConfig,
  rawIntent?: string,
): Promise<IntentResult> {
  let raw = rawIntent?.trim();
  if (!raw) {
    const answer = await p.text({
      message: chalk.yellow('What change will you make?'),
      placeholder: 'e.g. fix login bug when token expires, add dark mode to settings page',
      validate: (v) => { if (!v?.trim()) return 'Describe the change.'; },
    });
    if (p.isCancel(answer)) {
      p.cancel(chalk.yellow('Stopped. No changes were made.'));
      process.exit(0);
    }
    raw = (answer as string).trim();
  }
  assertSafeModelContext(config, raw);
  // Keywords extracted deterministically — not blocked by LLM
  const keywords = extractKeywords(raw);

  const s = p.spinner();
  s.start('Read repository rules and prepare your checklist.');

  const octokit = new Octokit({ auth: config.github_token, userAgent: 'project-layman' });
  const similarPRs = await fetchSimilarPRs(octokit, ctx.upstreamOwner, ctx.upstreamRepo, keywords);

  const guideText = guide.raw
    ? `Contribution guidelines:\n${guide.raw}`
    : '(no contribution guidelines found — apply general OSS best practices)';

  const prompt = `${CLI_EXPLANATION_RULES}

You are a senior open-source contributor reviewing a contribution plan.

Repository: ${ctx.upstreamOwner}/${ctx.upstreamRepo}
Contributor's intent: ${raw}

${guideText}
${similarPRs}

Produce a short prioritised checklist. Format exactly as:
1. [MUST] <item>
2. [MUST] <item>
3. [SHOULD] <item>
4. [NICE] <item>

Focus on: blockers, required steps, gotchas specific to this repo, test requirements, and risks.
Maximum 8 items. Be concrete and specific to the intent described. No preamble or explanation — just the numbered list.`;

  try {
    const checklist = (await callLLM(config, prompt, 600)).trim();
    s.stop('Checklist ready.');
    console.log('\n' + chalk.bold.yellow('Contribution checklist:'));
    console.log(checklist + '\n');
    return { raw, keywords, checklist };
  } catch (err) {
    s.stop('LLM failed');
    throw err;
  }
}
