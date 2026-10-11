import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-config-test-'));
const originalHomedir = os.homedir;
os.homedir = () => home;
const { loadConfig, saveConfig } = await import('../dist/config.js');
os.homedir = originalHomedir;
const configFile = path.join(home, '.layman', 'config.json');

after(() => fs.rmSync(home, { recursive: true, force: true }));

const config = {
  github_token: 'token',
  description_mode: 'llm',
  llm: { provider: 'ollama', api_key: null, model: 'llama3.2', base_url: 'http://localhost:11434' },
  editor: 'code',
  editor_command: 'code',
  workspace_dir: '/tmp/work',
  default_result_count: 12,
  clone_protocol: 'ssh',
};

test('persists every configuration setting with owner-only permissions', () => {
  saveConfig(config);
  assert.deepEqual(loadConfig(), config);
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
});

test('leaves the previous configuration intact when serialization fails', () => {
  const before = fs.readFileSync(configFile, 'utf8');
  assert.throws(() => saveConfig({ ...config, workspace_dir: BigInt(1) }));
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
});

test('uses a replace step and keeps the previous configuration when replacement fails', () => {
  const before = fs.readFileSync(configFile, 'utf8');
  const originalRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => {
    calls++;
    throw new Error(`cannot replace ${args[1]}`);
  };
  try {
    assert.throws(() => saveConfig({ ...config, default_result_count: 99 }), /cannot replace/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
});
