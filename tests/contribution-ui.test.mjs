import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

async function capture(run) {
  const original = console.log;
  const lines = [];
  console.log = value => lines.push(String(value));
  try { await run(); return lines.join('\n'); }
  finally { console.log = original; }
}

test('panels show saved context, step, and one next action', async () => {
  const { printContributionPanel } = await import('../dist/ui/contribution.js');
  const session = { repoPath: '/repo', branch: 'fix/login', ctx: { upstreamOwner: 'owner', upstreamRepo: 'project' } };
  const text = await capture(() => printContributionPanel(session, 4, 'Run layman --check.'));
  assert.match(text, /Step 4 of 7: Check work/);
  assert.match(text, /Repository  owner\/project/);
  assert.match(text, /Branch      fix\/login/);
  assert.match(text, /Progress    Saved/);
  assert.equal(text.match(/Next:/g).length, 1);
  const unsaved = await capture(() => printContributionPanel({ ...session, branch: 'pending-id' }, 3, 'Prepare a branch.', false));
  assert.match(unsaved, /Not prepared/);
  assert.match(unsaved, /Not saved/);
});

test('next commands preserve the repository folder from another working directory', async () => {
  const { contributionCommand } = await import('../dist/ui/contribution.js');
  assert.equal(contributionCommand({ repoPath: process.cwd() }, 'check'), 'layman --check');
  const repoPath = '/repo/a b\'s "$LAYMAN_UI_PATH"';
  const command = contributionCommand({ repoPath }, 'status');
  const args = execFileSync('/bin/sh', ['-c', `set -- ${command}; printf '%s\\0' "$@"`]).toString().split('\0').filter(Boolean);
  assert.deepEqual(args, ['layman', '--status', '--contribute', repoPath]);
});

test('summaries distinguish all states without requiring color or exposing logs', async () => {
  const { printCheckSummary } = await import('../dist/ui/contribution.js');
  const items = ['passed', 'failed', 'skipped', 'unknown', 'waiting'].map(state => ({ name: state, state, output: 'private log detail' }));
  const text = await capture(() => printCheckSummary(items));
  for (const label of ['[OK]', '[FAIL]', '[SKIP]', '[?]', '[WAIT]']) assert.ok(text.includes(label));
  for (const item of items) assert.ok(text.includes(`1 ${item.state}`));
  assert.doesNotMatch(text, /private log detail/);
  assert.match(await capture(() => printCheckSummary([])), /No project checks recorded/);
});

test('publication review preserves payload and ignores stale check success', async () => {
  const { printPublicationReview } = await import('../dist/ui/contribution.js');
  const session = {
    branch: 'fix/login', ctx: { upstreamOwner: 'owner', upstreamRepo: 'project', pushOwner: 'contributor', pushRepo: 'fork' },
    preview: { base: 'main', commit: 'fix: preserve --path "a  b"', title: 'Do not remove login', body: 'Run `npm test`. Do not delete files.', draft: true },
    checks: [{ command: 'npm test', fingerprint: 'old', result: 'passed' }],
    guide: { commands: [{ command: 'npm test' }], requirements: [{ text: 'Approval pending', status: 'unknown' }] },
  };
  const snapshot = { fingerprint: 'current', files: ['src/a  b.ts'], diff: '-old\n+new\n' };
  const text = await capture(() => printPublicationReview(session, snapshot));
  for (const payload of [session.preview.commit, session.preview.title, session.preview.body, snapshot.diff, JSON.stringify(snapshot.files[0])]) assert.ok(text.includes(payload));
  assert.match(text, /Target      owner\/project:main/);
  assert.match(text, /Push to     contributor\/fork:fix\/login/);
  assert.match(text, /Mode        Draft/);
  assert.match(text, /0 passed/);
  assert.match(text, /1 unknown/);
  assert.match(text, /Approval pending/);
});

test('term definitions appear once per CLI run', async () => {
  const { explainTerm } = await import('../dist/ui/contribution.js');
  const text = await capture(() => { explainTerm('sign-off'); explainTerm('sign-off'); });
  assert.equal(text.match(/Sign-off:/g).length, 1);
  assert.match(text, /not a cryptographic signature/);
});

test('check summaries use final current evidence and include missing sourced checks', async () => {
  const { getCheckSummary } = await import('../dist/ui/contribution.js');
  const session = {
    checks: [
      { command: 'npm test', fingerprint: 'current', result: 'interrupted', output: 'Command started' },
      { command: 'npm test', fingerprint: 'current', result: 'passed', output: 'Passed tests' },
      { command: 'npm lint', fingerprint: 'old', result: 'passed' },
    ],
    guide: { commands: [{ command: 'npm test' }, { command: 'npm lint' }], requirements: [{ action: 'check', command: 'npm run verify' }] },
  };
  const items = getCheckSummary(session, 'current', new Set(['npm lint']));
  assert.deepEqual(items.map(item => [item.name, item.state]), [['npm test', 'passed'], ['npm lint', 'skipped'], ['npm run verify', 'unknown']]);
  assert.equal(items[0].output, 'Passed tests');
});
