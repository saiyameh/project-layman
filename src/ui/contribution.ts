import chalk from 'chalk';
import type { ContributionSession } from '../contribute/state.js';
import type { ChangeSnapshot } from '../contribute/checks.js';

const steps = ['Connect model', 'Read rules', 'Prepare work', 'Check work', 'Review and publish', 'Wait for review', 'Finish contribution'];
const meanings = {
  branch: 'Branch: a separate work area.',
  commit: 'Commit: a set of changes saved in Git.',
  PR: 'PR: a request for the project to review changes.',
  CI: 'CI: automatic project checks.',
  fork: 'Fork: a copy of a repository in your GitHub account.',
  clone: 'Clone: a local copy of a repository.',
  diff: 'Diff: the changed lines.',
  'sign-off': 'Sign-off: an authorship statement. It is not a cryptographic signature.',
};
const explained = new Set<keyof typeof meanings>();

export function explainTerm(term: keyof typeof meanings): void {
  if (explained.has(term)) return;
  explained.add(term);
  console.log(meanings[term]);
}

export function contributionCommand(session: ContributionSession, operation: 'resume' | 'check' | 'submit' | 'status' | 'cleanup'): string {
  // shortcut: Displayed commands use POSIX quoting; add shell-specific quoting before supporting other shells.
  const folder = session.repoPath === process.cwd() ? '' : ` --contribute '${session.repoPath.replaceAll("'", "'\\''")}'`;
  return `layman --${operation}${folder}`;
}

export function printContributionPanel(session: ContributionSession, step: 1 | 2 | 3 | 4 | 5 | 6 | 7, next: string, saved = true): void {
  const repo = session.ctx ? `${session.ctx.upstreamOwner}/${session.ctx.upstreamRepo}` : session.repoPath;
  console.log(`\nLayman · Step ${step} of 7: ${steps[step - 1]}\n\nRepository  ${repo}\nBranch      ${session.branch.startsWith('pending-') ? 'Not prepared' : session.branch}\nProgress    ${saved ? 'Saved' : 'Not saved'}\n\nNext: ${next}\n`);
  if (!session.branch.startsWith('pending-')) explainTerm('branch');
}

export interface CheckSummaryItem {
  name: string;
  state: 'passed' | 'failed' | 'skipped' | 'unknown' | 'waiting';
  output?: string;
}

export function getCheckSummary(session: ContributionSession, fingerprint: string, skipped: Set<string> = new Set()): CheckSummaryItem[] {
  const checks = new Map(session.checks.filter(check => check.fingerprint === fingerprint).map(check => [check.command, check]));
  const commands = [...new Set([...(session.guide?.commands ?? []).map(command => command.command), ...(session.guide?.requirements ?? []).flatMap(requirement => requirement.action === 'check' && requirement.command ? [requirement.command] : []), ...checks.keys()])];
  return commands.map(name => {
    const check = checks.get(name);
    return { name, state: !check ? skipped.has(name) ? 'skipped' : 'unknown' : check.result === 'passed' ? 'passed' : 'failed', output: check?.output };
  });
}

export function printCheckSummary(items: CheckSummaryItem[]): void {
  if (!items.length) { console.log('[?] No project checks recorded.'); return; }
  const labels = { passed: chalk.green('[OK]'), failed: chalk.red('[FAIL]'), skipped: chalk.dim('[SKIP]'), unknown: chalk.yellow('[?]'), waiting: chalk.cyan('[WAIT]') };
  const counts = (Object.keys(labels) as CheckSummaryItem['state'][]).map(state => `${items.filter(item => item.state === state).length} ${state}`);
  console.log(`\nChecks: ${counts.join(' · ')}`);
  for (const item of items) console.log(`${labels[item.state]} ${item.name}`);
}

export function printPublicationReview(session: ContributionSession, snapshot: ChangeSnapshot): void {
  const ctx = session.ctx!;
  const preview = session.preview!;
  printCheckSummary(getCheckSummary(session, snapshot.fingerprint));
  console.log(`\nPublication review\nTarget      ${ctx.upstreamOwner}/${ctx.upstreamRepo}:${preview.base}\nPush to     ${ctx.pushOwner ?? ctx.forkOwner}/${ctx.pushRepo ?? ctx.upstreamRepo}:${session.branch}\nAction      ${session.prNumber ? `Update PR #${session.prNumber}` : 'Create PR'}\nMode        ${session.prNumber ? 'Keep existing PR mode' : preview.draft ? 'Draft' : 'Ready for review'}\n\nFiles (${snapshot.files.length}):\n${snapshot.files.map(file => JSON.stringify(file)).join('\n')}\n\nDiff:\n${snapshot.diff}\nCommit:\n${preview.commit}\n\nPR title${session.prNumber ? ' (proposal)' : ''}:\n${preview.title}\n\nPR body${session.prNumber ? ' (proposal)' : ''}:\n${preview.body}`);
  if (session.prNumber) console.log('Existing public text stays unless you approve replacement.');
  const unknowns = (session.guide?.requirements ?? []).filter(requirement => requirement.status === 'unknown');
  if (unknowns.length) console.log(`\n[?] Requirements remain unknown:\n${unknowns.map(requirement => requirement.text).join('\n')}`);
  explainTerm('diff');
  explainTerm('commit');
  explainTerm('PR');
}
