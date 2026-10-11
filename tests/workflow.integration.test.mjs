import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CLI_EXPLANATION_RULES } from '../dist/ui/caveman.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loader = path.join(root, 'tests/fixtures/clack-loader.mjs');
const runner = path.join(root, 'tests/fixtures/workflow-runner.mjs');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-workflow-'));

after(() => fs.rmSync(workspace, { recursive: true, force: true }));

function git(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }

function makeRepo(name, committed = false, seed = null) {
  const bare = path.join(workspace, `${name}.git`);
  const repo = path.join(workspace, name);
  git(['init', '--bare', '-q', bare]);
  git(['init', '-q', repo]);
  git(['-C', repo, 'config', 'user.email', 'test@example.com']);
  git(['-C', repo, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  for (const [file, content] of Object.entries(seed ?? {})) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  }
  git(['-C', repo, 'add', '.']);
  git(['-C', repo, 'commit', '-qm', 'base']);
  git(['-C', repo, 'branch', '-M', 'main']);
  const transport = path.join(workspace, `${name}-ssh`);
  fs.writeFileSync(transport, `#!/bin/sh\ncase "$*" in\n*git-receive-pack*) exec git-receive-pack '${bare}' ;;\n*git-upload-pack*) exec git-upload-pack '${bare}' ;;\n*) exit 1 ;;\nesac\n`, { mode: 0o700 });
  git(['-C', repo, 'remote', 'add', 'origin', 'git@github.com:fork/repo.git']);
  git(['-C', repo, 'config', 'core.sshCommand', transport]);
  git(['-C', repo, 'push', '-q', '-u', 'origin', 'main']);
  if (!seed) git(['-C', repo, 'checkout', '-qb', 'feat/test']);
  const baseSha = git(['-C', repo, 'rev-parse', 'HEAD']);
  if (!seed) fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
  if (committed) {
    git(['-C', repo, 'add', 'new.txt']);
    git(['-C', repo, 'commit', '-qm', 'feat: add file']);
  }
  return { repo: fs.realpathSync(repo), bare, baseSha };
}

function run(repo, baseSha, mode, prompts, prs = []) {
  const home = fs.mkdtempSync(path.join(workspace, 'home-'));
  const result = spawnSync(process.execPath, ['--experimental-loader', loader, runner], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LAYMAN_TEST_HOME: home, LAYMAN_TEST_PROMPTS: JSON.stringify(prompts), LAYMAN_WORKFLOW_INPUT: JSON.stringify({ repo, baseSha, home, mode, prs }) },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const submitPrompts = [['new.txt'], 'feat: add file', 'Add file', '## Summary\nAdd file', false, true];

test('publishes a new file once with a stable post-commit fingerprint', () => {
  const { repo, bare, baseSha } = makeRepo('fresh');
  const result = run(repo, baseSha, 'fresh', submitPrompts);
  assert.equal(result.error, null);
  assert.equal(result.outcome, 'published');
  assert.equal(result.creates, 1);
  assert.ok(result.modelPrompts.some(prompt => prompt.startsWith('Draft a public GitHub PR.')));
  for (const prompt of result.modelPrompts) assert.ok(!prompt.includes(CLI_EXPLANATION_RULES));
  const output = result.messages.join('\n');
  assert.match(output, /Step 4 of 7: Check work/);
  assert.match(output, /Publication review/);
  assert.match(output, /Target\s+acme\/upstream:main/);
  assert.match(output, /Next: Run layman --status/);
  assert.equal(git(['-C', repo, 'rev-list', '--count', 'main..HEAD']), '1');
  assert.equal(git(['--git-dir', bare, 'rev-parse', 'refs/heads/feat/test']), git(['-C', repo, 'rev-parse', 'HEAD']));
});

test('summarizes a trusted check before optionally showing its saved output', () => {
  const { repo, baseSha } = makeRepo('check-summary');
  const result = run(repo, baseSha, 'check-summary', [['new.txt'], true, false]);
  assert.equal(result.error, null);
  const output = result.messages.join('\n');
  assert.match(output, /Checks: 1 passed/);
  assert.match(output, /\[OK\].*node -e/);
  assert.doesNotMatch(output, /\ncheck output\n/);
  assert.match(output, /Next: Run layman --submit/);
});

test('resumes an already committed contribution without another commit', () => {
  const { repo, baseSha } = makeRepo('committed', true);
  const before = git(['-C', repo, 'rev-parse', 'HEAD']);
  const result = run(repo, baseSha, 'fresh', submitPrompts);
  assert.equal(result.error, null);
  assert.equal(result.outcome, 'published');
  assert.equal(git(['-C', repo, 'rev-parse', 'HEAD']), before);
  assert.equal(result.creates, 1);
});

test('recovers a lost PR response using its session marker without a duplicate', () => {
  const { repo, baseSha } = makeRepo('lost-pr');
  const result = run(repo, baseSha, 'lost-pr', [...submitPrompts, ['new.txt'], false, true]);
  assert.equal(result.error, null);
  assert.equal(result.outcome, 'published');
  assert.equal(result.creates, 1);
  assert.equal(result.session.pending, undefined);
  assert.equal(result.session.prNumber, 41);
});

test('refuses an open PR on the same branch that lacks this session marker', () => {
  const { repo, baseSha } = makeRepo('unowned');
  const prs = [{ number: 9, html_url: 'https://github.com/acme/upstream/pull/9', body: 'other work', state: 'open', merged_at: null, user: { login: 'other' }, head: { ref: 'feat/test', repo: { name: 'repo', owner: { login: 'fork' } } }, base: { ref: 'main' } }];
  const result = run(repo, baseSha, 'fresh', submitPrompts, prs);
  assert.match(result.error, /belongs to another open PR/i);
  assert.equal(result.creates, 0);
  assert.equal(git(['-C', repo, 'rev-list', '--count', 'main..HEAD']), '0');
});

test('undo refuses a reused PR and keeps local commits', () => {
  const { repo, baseSha } = makeRepo('undo', true);
  const before = git(['-C', repo, 'rev-parse', 'HEAD']);
  const prs = [{ number: 41, html_url: 'https://github.com/acme/upstream/pull/41', body: 'unmarked', state: 'open', merged: false, user: { login: 'fork' }, head: { ref: 'feat/test', repo: { name: 'repo', owner: { login: 'fork' } } }, base: { ref: 'main' } }];
  const result = run(repo, baseSha, 'undo-reused', [], prs);
  assert.match(result.error, /reused or changed/i);
  assert.equal(result.updates, 0);
  assert.equal(git(['-C', repo, 'rev-parse', 'HEAD']), before);
});

test('does not push committed files omitted from the publication preview', () => {
  const { repo, bare, baseSha } = makeRepo('omitted', true);
  fs.writeFileSync(path.join(repo, 'selected.txt'), 'selected\n');
  const result = run(repo, baseSha, 'fresh', [['selected.txt'], ...submitPrompts.slice(1)]);
  assert.match(result.error, /committed files.*preview/i);
  assert.equal(result.creates, 0);
  assert.equal(git(['--git-dir', bare, 'for-each-ref', '--format=%(refname)', 'refs/heads/feat/test']), '');
  assert.equal(git(['-C', repo, 'diff', '--cached', '--name-only']), '');
});

test('resumes a rejected push without another commit', () => {
  const { repo, bare, baseSha } = makeRepo('retry-push');
  const hook = path.join(bare, 'hooks/pre-receive');
  fs.writeFileSync(hook, `#!/bin/sh\nif [ ! -e '${bare}/retry' ]; then touch '${bare}/retry'; exit 1; fi\nexit 0\n`, { mode: 0o700 });
  const result = run(repo, baseSha, 'retry-push', [...submitPrompts, ['new.txt'], true]);
  assert.equal(result.error, null);
  assert.match(result.recoveredError, /Git push failed/);
  assert.equal(result.outcome, 'published');
  assert.equal(git(['-C', repo, 'rev-list', '--count', 'main..HEAD']), '1');
  assert.equal(result.creates, 1);
});

test('stops a commit hook from publishing an unselected file', () => {
  const { repo, bare, baseSha } = makeRepo('hook-file');
  fs.writeFileSync(path.join(repo, 'unselected.txt'), 'unrelated work\n');
  const hooks = git(['-C', repo, 'rev-parse', '--absolute-git-dir']);
  fs.writeFileSync(path.join(hooks, 'hooks/pre-commit'), '#!/bin/sh\ngit add -- unselected.txt\n', { mode: 0o700 });
  const result = run(repo, baseSha, 'fresh', submitPrompts);
  assert.match(result.error, /committed files.*preview/i);
  assert.equal(result.creates, 0);
  assert.equal(git(['--git-dir', bare, 'for-each-ref', '--format=%(refname)', 'refs/heads/feat/test']), '');
  assert.equal(fs.readFileSync(path.join(repo, 'unselected.txt'), 'utf8'), 'unrelated work\n');
});

test('undo refuses a PR whose head repository changed', () => {
  const { repo, baseSha } = makeRepo('undo-changed', true);
  const prs = [{ number: 41, state: 'open', merged: false, user: { login: 'fork' }, head: { ref: 'feat/test', repo: { name: 'different', owner: { login: 'fork' } } } }];
  const result = run(repo, baseSha, 'undo-changed', [true], prs);
  assert.match(result.error, /reused or changed/);
  assert.equal(result.updates, 0);
});

test('prepares, checks, resumes, and submits across repository layouts', () => {
  const fixtures = {
    js: { 'package.json': '{"name":"fixture"}', 'src/index.ts': 'export const value = 1;\n' },
    python: { 'pyproject.toml': '[project]\nname = "fixture"\n', 'app.py': 'value = 1\n' },
    go: { 'go.mod': 'module example.test/fixture\n', 'main.go': 'package main\n' },
    rust: { 'Cargo.toml': '[package]\nname = "fixture"\n', 'src/lib.rs': 'pub const VALUE: u8 = 1;\n' },
    unsupported: { 'main.clj': '(def value 1)\n' },
    monorepo: { 'packages/tool/package.json': '{"name":"fixture"}', 'packages/tool/index.ts': 'export {};\n' },
    docs: { 'README.md': '# Fixture\n' },
  };
  for (const [name, seed] of Object.entries(fixtures)) {
    const { repo, baseSha } = makeRepo(`matrix-${name}`, false, seed);
    const result = run(repo, baseSha, 'matrix', ['skip', true, ['new.txt'], 'unknown', ...submitPrompts]);
    assert.equal(result.error, null, `${name}: ${result.error}`);
    assert.equal(result.outcome, 'published', name);
    assert.equal(result.creates, 1, name);
    assert.equal(result.session.branchCreated, true, name);
    assert.equal(result.session.guide.requirements[0].status, 'unknown', name);
    assert.ok(result.session.acknowledgments['rule-1'], name);
  }
});

test('retries a rejected PR request without creating another commit', () => {
  const { repo, baseSha } = makeRepo('rejected-pr');
  const result = run(repo, baseSha, 'rejected-pr', [...submitPrompts, ['new.txt'], true]);
  assert.equal(result.error, null);
  assert.ok(result.recoveredError);
  assert.equal(result.outcome, 'published');
  assert.equal(result.creates, 1);
  assert.equal(git(['-C', repo, 'rev-list', '--count', 'main..HEAD']), '1');
});

test('retries a rejected issue request and records ownership after success', () => {
  const { repo, baseSha } = makeRepo('rejected-issue');
  const issuePrompts = ['create', 'Add file', '## Description\nAdd file', true];
  const result = run(repo, baseSha, 'rejected-issue', [...issuePrompts, ...issuePrompts]);
  assert.equal(result.error, null);
  assert.ok(result.recoveredError);
  assert.equal(result.creates, 1);
  assert.equal(result.session.issueCreated, true);
  assert.equal(result.session.pending, undefined);
  assert.ok(result.modelPrompts.some(prompt => prompt.startsWith('Draft a GitHub issue')));
  for (const prompt of result.modelPrompts) assert.ok(!prompt.includes(CLI_EXPLANATION_RULES));
});

test('resumption keeps the merge base when the target branch advances', () => {
  const { repo, baseSha } = makeRepo('advanced-target', false, { 'CONTRIBUTING.md': 'Open a pull request to `release`.' });
  git(['-C', repo, 'branch', 'feat/test']);
  git(['-C', repo, 'checkout', '-qb', 'release']);
  fs.writeFileSync(path.join(repo, 'upstream-only.txt'), 'upstream addition\n');
  git(['-C', repo, 'add', 'upstream-only.txt']);
  git(['-C', repo, 'commit', '-qm', 'upstream advance']);
  git(['-C', repo, 'push', '-q', 'origin', 'release']);
  git(['-C', repo, 'checkout', '-q', 'feat/test']);
  fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
  const result = run(repo, baseSha, 'target-advanced', [['new.txt']]);
  assert.equal(result.error, null);
  assert.equal(result.session.baseSha, baseSha);
  assert.deepEqual(result.session.selectedFiles, ['new.txt']);
});
