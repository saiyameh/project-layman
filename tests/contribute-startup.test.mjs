import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-contribute-test-'));
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(workspace, { recursive: true, force: true });
});

const config = {
  github_token: 'github-token',
  description_mode: 'llm',
  llm: { provider: 'ollama', api_key: null, model: 'llama3.2', base_url: 'http://localhost:11434' },
  editor: 'code',
  editor_command: 'code',
  workspace_dir: workspace,
  default_result_count: 10,
  clone_protocol: 'https',
};

test('stops before cloning when the required brain connection is rejected', async () => {
  const { runContributeFlow } = await import('../dist/contribute/index.js');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('provider diagnostic that must stay private', { status: 401 });
  };
  try {
    await assert.rejects(
      runContributeFlow(config, 'https://github.com/example/contribution-target.git', false),
      /login failed/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(path.join(workspace, 'contribution-target')), false);
});
