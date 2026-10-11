import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-preflight-'));
after(() => fs.rmSync(workspace, { recursive: true, force: true }));

function repo(owner, name, extra = {}) {
  return { owner: { login: owner }, name, fork: false, archived: false, disabled: false, default_branch: 'main', ...extra };
}

function client(repos, listed = []) {
  const get = async ({ owner, repo: name }) => {
    const value = repos[`${owner}/${name}`];
    if (!value) throw Object.assign(new Error('not found'), { status: 404 });
    return { data: value };
  };
  return {
    repos: {
      get,
      createFork: async ({ owner, repo: name }) => {
        repos[`me/${name}`] = repo('me', name, { fork: true, parent: { owner: { login: owner }, name } });
      },
      listForAuthenticatedUser: async () => ({ data: listed }),
    },
    paginate: async () => listed,
  };
}

test('parses GitHub HTTPS and SSH remotes only', async () => {
  const { parseGitUrl } = await import('../dist/contribute/preflight.js');
  assert.deepEqual(parseGitUrl('https://github.com/acme/project.git'), { owner: 'acme', repo: 'project' });
  assert.deepEqual(parseGitUrl('git@github.com:acme/project.git'), { owner: 'acme', repo: 'project' });
  assert.equal(parseGitUrl('https://example.com/acme/project.git'), null);
});

test('uses direct push access without requiring a fork', async () => {
  const { resolveRepoIdentity } = await import('../dist/contribute/preflight.js');
  const repos = { 'acme/project': repo('acme', 'project', { permissions: { push: true } }) };
  const identity = await resolveRepoIdentity(client(repos), 'me', { owner: 'acme', repo: 'project' });
  assert.deepEqual(identity, { base: { owner: 'acme', repo: 'project' }, push: { owner: 'acme', repo: 'project' }, originIsPush: true });
});

test('finds a renamed fork by its parent identity', async () => {
  const { resolveRepoIdentity } = await import('../dist/contribute/preflight.js');
  const repos = {
    'acme/project': repo('acme', 'project', { permissions: { push: false } }),
    'me/project': repo('me', 'project', { fork: true, parent: { owner: { login: 'other' }, name: 'project' } }),
    'me/my-project-copy': repo('me', 'my-project-copy', { fork: true, parent: { owner: { login: 'acme' }, name: 'project' } }),
  };
  const identity = await resolveRepoIdentity(client(repos, [repos['me/my-project-copy']]), 'me', { owner: 'acme', repo: 'project' });
  assert.deepEqual(identity.push, { owner: 'me', repo: 'my-project-copy' });
});

test('finds the top-level repository from a nested directory and rejects dirt', async () => {
  const { assertSafeWorktree } = await import('../dist/contribute/preflight.js');
  const dir = path.join(workspace, 'worktree');
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'ok\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'initial']);
  const safe = await assertSafeWorktree(path.join(dir, 'nested'));
  assert.equal(safe.repoPath, fs.realpathSync(dir));
  fs.writeFileSync(path.join(dir, 'README.md'), 'changed\n');
  await assert.rejects(assertSafeWorktree(dir), /uncommitted work/);
  await assert.doesNotReject(assertSafeWorktree(dir, true));
});

test('rejects an upstream remote that names a sibling fork', async () => {
  const { runPreflight } = await import('../dist/contribute/preflight.js');
  const dir = path.join(workspace, 'sibling');
  fs.mkdirSync(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args]);
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('remote', 'add', 'origin', 'git@github.com:me/project.git');
  git('remote', 'add', 'upstream', 'git@github.com:other/project.git');
  git('config', 'core.sshCommand', '/usr/bin/false');
  const repos = {
    'acme/project': repo('acme', 'project'),
    'me/project': repo('me', 'project', { fork: true, parent: { owner: { login: 'acme' }, name: 'project' } }),
    'other/project': repo('other', 'project', { fork: true, parent: { owner: { login: 'acme' }, name: 'project' } }),
  };
  const config = { llm: { provider: 'ollama', model: 'test', api_key: null, base_url: null } };
  await assert.rejects(runPreflight(dir, config, { client: client(repos), forkOwner: 'me', resume: true }), /upstream remote is other\/project, but the base is acme\/project/);
});

test('keeps local identity errors clear and masks remote diagnostic text', async () => {
  const { runPreflight } = await import('../dist/contribute/preflight.js');
  const dir = path.join(workspace, 'identity-errors');
  fs.mkdirSync(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args]);
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-qm', 'base');
  git('remote', 'add', 'origin', 'git@github.com:me/project.git');
  const config = { llm: { provider: 'ollama', model: 'test', api_key: null, base_url: null } };
  const api = client({ 'me/project': repo('me', 'project', { archived: true }) });
  await assert.rejects(runPreflight(dir, config, { client: api, forkOwner: 'me' }), /me\/project is archived/);
  api.repos.get = async () => { throw new TypeError('private network diagnostic'); };
  await assert.rejects(runPreflight(dir, config, { client: api, forkOwner: 'me' }), error => {
    assert.equal(error.message, 'Cannot verify me/project.');
    return true;
  });
});
