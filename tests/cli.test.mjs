import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-cli-home-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-cli-work-'));
const root = path.resolve('.');
after(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
});

function run(args, extra = {}) {
  return spawnSync(process.execPath, ['tests/fixtures/cli-runner.mjs', ...args], {
    cwd: path.resolve('.'), encoding: 'utf8', env: { ...process.env, LAYMAN_TEST_HOME: home, ...extra },
  });
}

function runStartMenu(prompts, extra = {}) {
  const menuHome = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-start-menu-home-'));
  const result = spawnSync(process.execPath, [
    '--experimental-loader', path.join(root, 'tests/fixtures/start-menu-loader.mjs'),
    path.join(root, 'tests/fixtures/start-menu-runner.mjs'),
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LAYMAN_TEST_HOME: menuHome, LAYMAN_TEST_PROMPTS: JSON.stringify(prompts), ...extra },
  });
  fs.rmSync(menuHome, { recursive: true, force: true });
  return result;
}

test('invalid flags stop before config or repository mutation', () => {
  const result = run(['--undo', '--resume']);
  assert.equal(result.status, 1);
  assert.match(result.stderr + result.stdout, /Use --undo by itself/);
  assert.equal(fs.existsSync(path.join(home, '.layman')), false);
});

test('help explains Git contribution words', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /branch\s+Separate work area/);
  assert.match(result.stdout, /fork\s+Copy of a repository in your GitHub account/);
  assert.match(result.stdout, /clone\s+Local copy of a repository/);
  assert.match(result.stdout, /commit\s+Saved change/);
  assert.match(result.stdout, /PR\s+Request for review before merge/);
  assert.match(result.stdout, /CI\s+Automatic checks that run for a PR/);
});

test('bare interactive mode starts or resumes contribution work from the menu', () => {
  const start = runStartMenu(['start', 'https://github.com/owner/repository']);
  const resume = runStartMenu(['resume', '/work/repository']);

  assert.equal(start.status, 0, start.stderr);
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(start.stdout, /"path":"https:\/\/github\.com\/owner\/repository"/);
  assert.match(start.stdout, /"operation":"prepare"/);
  assert.match(resume.stdout, /"path":"\/work\/repository"/);
  assert.match(resume.stdout, /"operation":"resume"/);
});

test('bare non-interactive mode gives a command instead of waiting for a menu', () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr + result.stdout, /--contribute <folder-or-GitHub-URL>/);
});

test('undo dispatches without model or GitHub calls when no state exists', () => {
  const configDir = path.join(home, '.layman');
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const config = {
    github_token: 'not-used', description_mode: 'llm',
    llm: { provider: null, api_key: null, model: null, base_url: null },
    editor: 'code', editor_command: 'code', workspace_dir: workspace,
    default_result_count: 10, clone_protocol: 'https',
  };
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  const repo = path.join(workspace, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'ok\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'initial']);
  const result = run(['--undo', '--contribute', repo]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /No verified contribution state/);
  assert.equal(fs.existsSync(path.join(repo, '.layman')), false);
});
