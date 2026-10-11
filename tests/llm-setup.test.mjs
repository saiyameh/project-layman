import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loader = path.join(root, 'tests/fixtures/clack-loader.mjs');
const runner = path.join(root, 'tests/fixtures/run-llm-setup.mjs');
const baseConfig = (llm) => ({
  github_token: 'github-token',
  description_mode: 'llm',
  llm,
  editor: 'code', editor_command: 'code', workspace_dir: '/tmp/work', default_result_count: 10, clone_protocol: 'https',
});

function runSetup(config, prompts, probe = 'ok', saved = undefined) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-setup-test-'));
  const result = spawnSync(process.execPath, ['--experimental-loader', loader, runner], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
        LAYMAN_TEST_HOME: home,
      LAYMAN_TEST_PROMPTS: JSON.stringify(prompts),
      LAYMAN_TEST_INPUT: JSON.stringify({ config, probe, saved }),
    },
  });
  return { ...result, home };
}

function cleanup(result) {
  fs.rmSync(result.home, { recursive: true, force: true });
}

test('keeps a compatible-provider key only when its URL is unchanged', () => {
  const current = baseConfig({ provider: 'openai-compatible', api_key: 'saved-key', model: 'old-model', base_url: 'https://provider.example/v1' });
  const same = runSetup(current, ['openai-compatible', 'custom', 'https://provider.example/v1', '', 'new-model']);
  const changed = runSetup(current, ['openai-compatible', 'custom', 'https://new-provider.example/v1', '', 'new-model']);
  try {
    assert.equal(same.status, 0, same.stderr);
    assert.equal(changed.status, 0, changed.stderr);
    const sameResult = JSON.parse(same.stdout).result;
    const changedResult = JSON.parse(changed.stdout).result;
    assert.equal(sameResult.llm.api_key, 'saved-key');
    assert.equal(changedResult.llm.api_key, null);
    const { llm: _sameLLM, ...sameSettings } = sameResult;
    const { llm: _changedLLM, ...changedSettings } = changedResult;
    const { llm: _currentLLM, ...expectedSettings } = current;
    assert.deepEqual(sameSettings, expectedSettings);
    assert.deepEqual(changedSettings, expectedSettings);
  } finally {
    cleanup(same);
    cleanup(changed);
  }
});

test('does not overwrite a saved configuration when the brain probe fails', () => {
  const saved = baseConfig({ provider: 'openai-compatible', api_key: 'saved-key', model: 'old-model', base_url: 'https://provider.example/v1' });
  const result = runSetup(saved, ['openai-compatible', 'custom', 'https://provider.example/v1', '', 'new-model'], 'fail', saved);
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /login failed/i);
    const savedPath = path.join(result.home, '.layman', 'config.json');
    assert.equal(fs.readFileSync(savedPath, 'utf8'), JSON.stringify(saved));
  } finally {
    cleanup(result);
  }
});

test('--brain reconfigures before GitHub authentication or connectivity checks', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-brain-cli-test-'));
  const log = path.join(home, 'requests.log');
  const config = baseConfig({ provider: 'openai-compatible', api_key: 'saved-key', model: 'old-model', base_url: 'https://provider.example/v1' });
  try {
    fs.mkdirSync(path.join(home, '.layman'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(home, '.layman', 'config.json'), JSON.stringify(config), { mode: 0o600 });
    const result = spawnSync(process.execPath, ['--experimental-loader', loader, 'dist/index.js', '--brain'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        LAYMAN_TEST_HOME: home,
        LAYMAN_TEST_FETCH_LOG: log,
        LAYMAN_TEST_PROMPTS: JSON.stringify(['openai-compatible', 'custom', 'https://provider.example/v1', '', 'new-model']),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['https://provider.example/v1/chat/completions']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
