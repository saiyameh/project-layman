import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-state-home-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-checks-'));
const originalHomedir = os.homedir;
os.homedir = () => home;
const state = await import('../dist/contribute/state.js');
const checks = await import('../dist/contribute/checks.js');
const { stageSelected } = await import('../dist/contribute/submission.js');

after(() => {
  os.homedir = originalHomedir;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
});

function git(args) { return execFileSync('git', args, { encoding: 'utf8' }); }

function initRepo(name) {
  const repo = path.join(workspace, name);
  fs.mkdirSync(repo, { recursive: true });
  git(['init', '-q', repo]);
  git(['-C', repo, 'config', 'user.email', 'test@example.com']);
  git(['-C', repo, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'base\n');
  fs.writeFileSync(path.join(repo, 'delete.txt'), 'delete\n');
  git(['-C', repo, 'add', '.']);
  git(['-C', repo, 'commit', '-qm', 'base']);
  return repo;
}

test('state uses atomic owner-only writes and rejects stale sessions', () => {
  const repo = path.join(workspace, 'state-repo');
  fs.mkdirSync(repo, { recursive: true });
  const first = state.newSession(repo, 'main', { origin: 'https://github.com/acme/repo.git' }, 'a'.repeat(40));
  first.branch = 'feat/one';
  state.saveSession(first);
  assert.equal(fs.statSync(state.statePath()).mode & 0o777, 0o600);
  assert.equal(first.revision, 1);
  const stale = { ...first, revision: 0 };
  first.stage = 'coding';
  state.saveSession(first);
  assert.throws(() => state.saveSession(stale), /changed in another process/);
  assert.equal(state.loadSessions()[0].stage, 'coding');
  const second = state.newSession(repo, 'main', { origin: 'https://github.com/acme/repo.git' }, 'a'.repeat(40));
  second.branch = 'fix/two';
  state.saveSession(second);
  assert.equal(state.loadSessions().length, 2);
});

test('state preserves corrupt data and refuses a concurrent lock', () => {
  const file = state.statePath();
  fs.writeFileSync(file, '{bad json');
  assert.throws(() => state.loadSessions(), /state is invalid/);
  fs.writeFileSync(file, JSON.stringify({ version: 2, sessions: [] }));
  fs.writeFileSync(`${file}.lock`, 'other process', { mode: 0o600 });
  const session = state.newSession(path.join(workspace, 'lock-repo'), 'main', {}, 'b'.repeat(40));
  assert.throws(() => state.saveSession(session), /state is locked/);
  assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), 'other process');
  fs.unlinkSync(`${file}.lock`);
});

test('captures real Git changes safely and fingerprints all changed work', async () => {
  const repo = initRepo('capture');
  const base = git(['-C', repo, 'rev-parse', 'HEAD']).trim();
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'changed\n');
  fs.renameSync(path.join(repo, 'delete.txt'), path.join(repo, 'renamed name.txt'));
  fs.writeFileSync(path.join(repo, 'new file.txt'), 'new\n');
  fs.writeFileSync(path.join(repo, 'LAYMAN_BRIEF.md'), 'tool note\n');
  const snapshot = await checks.captureChanges(repo, base, ['keep.txt', 'delete.txt', 'renamed name.txt', 'new file.txt']);
  assert.deepEqual(snapshot.files, ['delete.txt', 'keep.txt', 'new file.txt', 'renamed name.txt']);
  assert.match(snapshot.diff, /new file\.txt/);
  assert.ok(!snapshot.files.includes('LAYMAN_BRIEF.md'));
  git(['-C', repo, 'add', '.']);
  git(['-C', repo, 'commit', '-qm', 'same contribution committed']);
  const afterCommit = await checks.captureChanges(repo, base, ['keep.txt', 'delete.txt', 'renamed name.txt', 'new file.txt']);
  assert.equal(afterCommit.fingerprint, snapshot.fingerprint);
  fs.writeFileSync(path.join(repo, 'unselected.txt'), 'changes the fingerprint\n');
  const later = await checks.captureChanges(repo, base, ['keep.txt', 'delete.txt', 'renamed name.txt', 'new file.txt']);
  assert.notEqual(later.fingerprint, snapshot.fingerprint);
  fs.writeFileSync(path.join(repo, 'secret.txt'), `ghp_${'A'.repeat(36)}\n`);
  await assert.rejects(checks.captureChanges(repo, base), /possible secret/);
});

test('trusted commands require approval, redact output, and have bounded execution', async () => {
  const repo = initRepo('commands');
  const marker = path.join(repo, 'ran');
  await assert.rejects(checks.runTrustedCommand(repo, `echo ran > ${JSON.stringify(marker)}`, 'f'.repeat(64), 'check', false), /no execution approval/);
  assert.equal(fs.existsSync(marker), false);
  const saved = process.env.TEST_SECRET;
  process.env.TEST_SECRET = 'should-not-reach-command';
  try {
    const hidden = await checks.runTrustedCommand(repo, `${JSON.stringify(process.execPath)} -e "console.log(process.env.TEST_SECRET || 'absent'); console.log('literal-secret'); console.log('ghp_' + 'A'.repeat(36))"`, 'f'.repeat(64), 'check', true, 1000, ['literal-secret']);
    assert.equal(hidden.result, 'passed');
    assert.match(hidden.output, /absent/);
    assert.ok(!hidden.output.includes('literal-secret'));
    assert.ok(!hidden.output.includes(`ghp_${'A'.repeat(36)}`));
    const failed = await checks.runTrustedCommand(repo, `${JSON.stringify(process.execPath)} -e "process.exit(3)"`, 'f'.repeat(64), 'check', true, 1000);
    assert.equal(failed.result, 'failed');
    const timeout = await checks.runTrustedCommand(repo, `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 1000)"`, 'f'.repeat(64), 'check', true, 20);
    assert.equal(timeout.result, 'timeout');
  } finally {
    if (saved === undefined) delete process.env.TEST_SECRET;
    else process.env.TEST_SECRET = saved;
  }
});

test('staging refuses pre-staged user work and leaves it intact', async () => {
  const repo = initRepo('stage');
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'user staged work\n');
  git(['-C', repo, 'add', 'keep.txt']);
  fs.writeFileSync(path.join(repo, 'contribution.txt'), 'new contribution\n');
  const session = state.newSession(repo, 'main', {}, git(['-C', repo, 'rev-parse', 'HEAD']).trim());
  session.branch = 'feat/contribution';
  state.saveSession(session);
  await assert.rejects(stageSelected(session, ['contribution.txt']), /index contains unrelated files/);
  assert.deepEqual(git(['-C', repo, 'diff', '--cached', '--name-only']).trim().split('\n'), ['keep.txt']);
});

test('captures paths with Git pathspec syntax as literal filenames', async () => {
  const repo = initRepo('literal');
  fs.writeFileSync(path.join(repo, ':literal.txt'), 'before\n');
  git(['-C', repo, 'add', '--', ':(literal):literal.txt']);
  git(['-C', repo, 'commit', '-qm', 'literal base']);
  const base = git(['-C', repo, 'rev-parse', 'HEAD']).trim();
  fs.writeFileSync(path.join(repo, ':literal.txt'), 'after\n');
  const snapshot = await checks.captureChanges(repo, base, [':literal.txt']);
  assert.match(snapshot.diff, /\+after/);
});

test('public drafts reject credentials and internal brief paths', async () => {
  const { validatePublicText } = await import('../dist/contribute/submission.js');
  for (const text of ['AKIA' + 'A'.repeat(16), 'sk-' + 'B'.repeat(36), '/tmp/.layman/briefs/note.md', 'configured-oauth-secret']) {
    assert.throws(() => validatePublicText(text, '/tmp/repo', ['configured-oauth-secret']), /secret|internal note/);
  }
});

test('cancellation stops a trusted command that ignores SIGTERM', () => {
  if (process.platform === 'win32') return;
  const output = execFileSync(process.execPath, ['tests/fixtures/command-interrupt.mjs'], { encoding: 'utf8', timeout: 3500 });
  const result = JSON.parse(output);
  assert.equal(result.evidence.result, 'interrupted');
  assert.ok(result.elapsed < 3000);
});
