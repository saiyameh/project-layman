import assert from 'node:assert/strict';
import test from 'node:test';

const config = {
  llm: { provider: 'ollama', api_key: null, model: 'test', base_url: 'http://localhost:11434' },
};

const guide = {
  raw: 'Run `npm test` before opening a PR.', sourcePath: 'CONTRIBUTING.md',
  sources: [{
    id: 'rules', path: 'CONTRIBUTING.md', ref: 'abc123', status: 'found',
    content: 'Run `npm test` before opening a PR.', excerpt: 'Run `npm test` before opening a PR.',
  }],
};

async function withReply(reply, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ response: reply }));
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('policy interpretation keeps evidence and marks every rule unknown', async () => {
  const { interpretPolicy } = await import('../dist/contribute/policy.js');
  const response = JSON.stringify({ requirements: [{
    text: 'Run tests before a PR.', kind: 'required', sourceId: 'rules',
    excerpt: 'Run `npm test` before opening a PR.', action: 'check', command: 'npm test',
  }] });
  await withReply(response, async () => {
    const result = await interpretPolicy(guide, config);
    assert.deepEqual(result.requirements?.map(rule => rule.status), ['unknown']);
    assert.deepEqual(result.commands, [{ command: 'npm test', kind: 'check', sourceId: 'rules' }]);
  });
});

test('policy interpretation rejects fabricated excerpts and commands', async () => {
  const { interpretPolicy } = await import('../dist/contribute/policy.js');
  for (const patch of [
    { excerpt: 'Run rm -rf /', command: 'rm -rf /' },
    { excerpt: 'Run `npm test` before opening a PR.', command: 'npm publish' },
  ]) {
    const response = JSON.stringify({ requirements: [{
      text: 'Unsafe rule.', kind: 'required', sourceId: 'rules', action: 'check', ...patch,
    }] });
    await withReply(response, () => assert.rejects(interpretPolicy(guide, config), /evidence|command/i));
  }
});

test('legacy flags require source-backed, non-negated requirements', async () => {
  const { applyPolicyLegacyFlags } = await import('../dist/contribute/policy.js');
  const result = applyPolicyLegacyFlags({ ...guide, requirements: [
    { id: 'one', text: 'Issue first.', kind: 'required', status: 'unknown', sourceId: 'rules', excerpt: 'Issues are not required.', action: 'issue' },
    { id: 'two', text: 'Sign off.', kind: 'required', status: 'unknown', sourceId: 'rules', excerpt: 'DCO sign-off is required.', action: 'manual' },
  ] });
  assert.equal(result.issueRequired, false);
  assert.equal(result.signOffRequired, true);
});

test('policy interpretation reports malformed JSON shapes without a runtime error', async () => {
  const { interpretPolicy } = await import('../dist/contribute/policy.js');
  for (const reply of ['null', '[]', 'true', '{"requirements":null}']) {
    await withReply(reply, () => assert.rejects(interpretPolicy(guide, config), /invalid requirements list/));
  }
});
