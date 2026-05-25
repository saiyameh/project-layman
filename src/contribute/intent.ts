import * as p from '@clack/prompts';
import chalk from 'chalk';
import { Octokit } from '@octokit/rest';
import { callLLM } from './llm.js';
import type { ContributionGuide } from './reader.js';
import type { RepoContext } from './preflight.js';
import type { LaymanConfig } from '../config.js';
import { printError } from '../ui/display.js';

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
): Promise<IntentResult> {
  const answer = await p.text({
    message: chalk.yellow('UGH. WHAT YOU WANT DO TO THIS CAVE? (fix bug? add feature? improve docs?)'),
    placeholder: 'e.g. fix login bug when token expires, add dark mode to settings page',
    validate: (v) => { if (!v?.trim()) return 'UGH. SAY SOMETHING.'; },
  });
  if (p.isCancel(answer)) {
    p.cancel(chalk.yellow('UGH. CAVE PERSON LEAVE. BYE.'));
    process.exit(0);
  }

  const raw = (answer as string).trim();
  // Keywords extracted deterministically — not blocked by LLM
  const keywords = extractKeywords(raw);

  const s = p.spinner();
  s.start('UGH. THINKING HARD ABOUT YOUR PLAN...');

  const octokit = new Octokit({ auth: config.github_token, userAgent: 'project-layman' });
  const similarPRs = await fetchSimilarPRs(octokit, ctx.upstreamOwner, ctx.upstreamRepo, keywords);

  const guideText = guide.raw
    ? `Contribution guidelines:\n${guide.raw}`
    : '(no contribution guidelines found — apply general OSS best practices)';

  const prompt = `You are a senior open-source contributor reviewing a contribution plan.

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

  let checklist: string;
  try {
    checklist = (await callLLM(config, prompt, 600)).trim();
  } catch (err) {
    s.stop('LLM failed');
    printError(`UGH. BRAIN NO WORK: ${(err as Error).message}`);
    process.exit(1);
  }

  s.stop('UGH. GOT PLAN.');

  console.log('\n' + chalk.bold.yellow('Critical Points:'));
  console.log(checklist + '\n');

  return { raw, keywords, checklist };
}
