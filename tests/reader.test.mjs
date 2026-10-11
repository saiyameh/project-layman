import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-reader-'));
const networkFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
const run = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
const context = (baseSha) => ({ repoPath: root, upstreamOwner: 'cave', upstreamRepo: 'tool', forkOwner: 'person', defaultBranch: 'main', language: ['js'], cloneProtocol: 'https', baseSha });
const config = { github_token: 'token' };

run(['init', '-q']);
run(['config', 'user.email', 'cave@example.com']);
run(['config', 'user.name', 'Cave']);
write('CONTRIBUTING.md', 'Use branch `cave/work`. Open a pull request to `main`.');
write('.github/PULL_REQUEST_TEMPLATE.md', '## Old template');
run(['add', '.']); run(['commit', '-m', 'first']);
const first = run(['rev-parse', 'HEAD']);

after(() => { globalThis.fetch = networkFetch; fs.rmSync(root, { recursive: true, force: true }); });

test('reads rules and templates from the verified base revision, not local edits', async () => {
  const { readContributionGuide } = await import('../dist/contribute/reader.js');
  write('CONTRIBUTING.md', 'Local rule must not appear.');
  write('.github/PULL_REQUEST_TEMPLATE.md', '## Local template must not appear');
  const guide = await readContributionGuide(context(first), config);
  assert.match(guide.raw, /cave\/work/);
  assert.doesNotMatch(guide.raw, /Local rule/);
  assert.equal(guide.prTemplate, '## Old template');
  assert.equal(guide.prTargetBranch, 'main');
  assert.equal(guide.templates?.[0]?.content, '## Old template');
  assert.equal(guide.sources?.find(source => source.path === 'CONTRIBUTING.md')?.ref, first);
});

test('changes at a new base revision invalidate the policy hash', async () => {
  const { readContributionGuide } = await import('../dist/contribute/reader.js');
  const oldGuide = await readContributionGuide(context(first), config);
  write('CONTRIBUTING.md', 'Use branch `new/work`. Open a pull request to `release`.');
  write('.github/PULL_REQUEST_TEMPLATE.md', '## New template');
  run(['add', '.']); run(['commit', '-m', 'second']);
  const second = run(['rev-parse', 'HEAD']);
  const newGuide = await readContributionGuide(context(second), config);
  assert.notEqual(newGuide.policyHash, oldGuide.policyHash);
  assert.match(newGuide.raw, /new\/work/);
  assert.equal(newGuide.prTemplate, '## New template');
});

test('records organization defaults as API evidence and hashes their content', async () => {
  const { readContributionGuide } = await import('../dist/contribute/reader.js');
  const originalFetch = globalThis.fetch;
  let template = '## Account default A';
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/repos/cave/.github')) return new Response(JSON.stringify({ private: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/repos/cave/.github/contents/.github%2FPULL_REQUEST_TEMPLATE.md')) {
      return new Response(JSON.stringify({ type: 'file', content: Buffer.from(template).toString('base64') }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    fs.rmSync(path.join(root, '.github/PULL_REQUEST_TEMPLATE.md'));
    run(['add', '-u']); run(['commit', '-m', 'remove local template']);
    const base = run(['rev-parse', 'HEAD']);
    const one = await readContributionGuide(context(base), config);
    template = '## Account default B';
    const two = await readContributionGuide(context(base), config);
    assert.equal(one.prTemplate, '## Account default A');
    assert.equal(one.templates?.[0]?.ref, 'api:cave/.github');
    assert.ok(one.sources?.some(source => source.path.startsWith('github:cave/.github/')));
    assert.notEqual(one.policyHash, two.policyHash);
  } finally { globalThis.fetch = originalFetch; }
});

test('keeps issue templates while resolving an account-default PR template', async () => {
  const { readContributionGuide } = await import('../dist/contribute/reader.js');
  write('.github/ISSUE_TEMPLATE/bug.md', '## Bug');
  run(['add', '.']); run(['commit', '-m', 'issue template']);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/repos/cave/.github')) return new Response(JSON.stringify({ private: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    return url.includes('/repos/cave/.github/contents/.github%2FPULL_REQUEST_TEMPLATE.md')
      ? new Response(JSON.stringify({ type: 'file', content: Buffer.from('## Account PR').toString('base64') }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    const guide = await readContributionGuide(context(run(['rev-parse', 'HEAD'])), config);
    assert.deepEqual(guide.templates?.map(template => template.kind).sort(), ['issue', 'pr']);
    assert.equal(guide.prTemplate, '## Account PR');
  } finally { globalThis.fetch = originalFetch; }
});

test('discovers policy filenames with newline characters from the Git tree', async () => {
  const { readContributionGuide } = await import('../dist/contribute/reader.js');
  fs.rmSync(path.join(root, 'CONTRIBUTING.md'));
  write('.github/PULL_REQUEST_TEMPLATE.md', '## Template');
  write('docs/guideline\nname.md', 'Run `npm test` from the verified tree.');
  run(['add', '-A']); run(['commit', '-m', 'exotic policy name']);
  const guide = await readContributionGuide(context(run(['rev-parse', 'HEAD'])), config);
  assert.equal(guide.sourcePath, 'docs/guideline\nname.md');
  assert.match(guide.raw, /verified tree/);
});

test('keeps an unavailable template discovery as an explicit review requirement', async () => {
  const { readContributionGuide } = await import('../dist/contribute/reader.js');
  fs.rmSync(path.join(root, '.github/PULL_REQUEST_TEMPLATE.md'));
  run(['add', '-u']); run(['commit', '-m', 'remove PR template again']);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
  try {
    const guide = await readContributionGuide(context(run(['rev-parse', 'HEAD'])), config);
    assert.equal(guide.sources?.find(source => source.path === 'github:policy-discovery')?.status, 'unknown');
    assert.ok(guide.requirements?.some(rule => rule.sourceId === guide.sources?.find(source => source.path === 'github:policy-discovery')?.id));
  } finally { globalThis.fetch = originalFetch; }
});

test('does not use private account defaults and lets local issue config override account forms', async () => {
  const { readContributionGuide } = await import('../dist/contribute/reader.js');
  write('.github/ISSUE_TEMPLATE/config.yml', 'blank_issues_enabled: false');
  run(['add', '.']); run(['commit', '-m', 'issue config']);
  const originalFetch = globalThis.fetch;
  let accountContentCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/repos/cave/.github')) return new Response(JSON.stringify({ private: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/repos/cave/.github/contents/')) accountContentCalls++;
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    const guide = await readContributionGuide(context(run(['rev-parse', 'HEAD'])), config);
    assert.equal(guide.prTemplate, null);
    assert.equal(accountContentCalls, 0);
    assert.equal(guide.sources?.find(source => source.path === '.github/ISSUE_TEMPLATE/config.yml')?.status, 'found');
  } finally { globalThis.fetch = originalFetch; }
});

test('uses account default path precedence and the correct issue directory', async () => {
  const { readContributionGuide } = await import('../dist/contribute/reader.js');
  const bareBase = run(['rev-parse', `${first}^{tree}`]);
  // A commit with an empty tree isolates the account defaults from local overrides.
  const emptyTree = execFileSync('git', ['-C', root, 'hash-object', '-t', 'tree', '--stdin', '-w'], { input: '', encoding: 'utf8' }).trim();
  const base = execFileSync('git', ['-C', root, 'commit-tree', emptyTree], { input: 'empty fixture\n', encoding: 'utf8' }).trim();
  assert.notEqual(emptyTree, bareBase);
  const originalFetch = globalThis.fetch;
  const seen = [];
  const files = {
    '.github/CONTRIBUTING.md': 'Use the account rules.',
    'CONTRIBUTING.md': 'Lower priority rules must not appear.',
    'docs/SECURITY.md': 'Report security bugs privately.',
    'CODE_OF_CONDUCT.md': 'Follow the conduct rules.',
    'docs/PULL_REQUEST_TEMPLATE.md': '## Account Summary',
    '.github/ISSUE_TEMPLATE/bug.yml': 'name: Bug\nbody: []',
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/cave/.github') return new Response(JSON.stringify({ private: false }), { headers: { 'content-type': 'application/json' } });
    const prefix = '/repos/cave/.github/contents/';
    const name = decodeURIComponent(url.pathname.slice(prefix.length));
    let data;
    if (url.pathname.startsWith(prefix)) {
      seen.push(name);
      if (name === '.github/ISSUE_TEMPLATE') data = [{ type: 'file', name: 'bug.yml', path: '.github/ISSUE_TEMPLATE/bug.yml' }];
      else if (files[name]) data = { type: 'file', content: Buffer.from(files[name]).toString('base64') };
    }
    return new Response(JSON.stringify(data ?? { message: 'Not Found' }), { status: data ? 200 : 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    const guide = await readContributionGuide(context(base), config);
    assert.equal(guide.raw, 'Use the account rules.');
    assert.equal(guide.prTemplate, '## Account Summary');
    assert.ok(guide.sources.some(source => source.content === 'Report security bugs privately.'));
    assert.ok(guide.templates.some(template => template.kind === 'issue-form'));
    assert.ok(!seen.includes('CONTRIBUTING.md'));
    assert.ok(seen.includes('.github/ISSUE_TEMPLATE'));
  } finally { globalThis.fetch = originalFetch; }
});
