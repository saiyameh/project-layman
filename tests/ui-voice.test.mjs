import assert from 'node:assert/strict';
import test from 'node:test';

const config = { github_token: 'test-token', llm: { provider: 'ollama', api_key: null, model: 'test', base_url: 'http://localhost:11434' } };

test('startup keeps the caveman artwork and exact project subtitle', async () => {
  const { printBanner } = await import('../dist/ui/display.js');
  const original = console.log;
  let output = '';
  console.log = value => { output += String(value); };
  try { printBanner(); } finally { console.log = original; }
  assert.ok(output.includes('⠈⠙⠛⠲⠦⠤⣄⣀⠀⢀⣀⣀'));
  assert.ok(output.includes('⢀⣠⣤⣤⣤⣄⡉⠁⣠⡄⢀⣀⣼⣿'));
  assert.equal(output.split('\n').filter(line => /[\u2800-\u28ff]/u.test(line)).length, 15);
  assert.match(output, /PROJECT LAYMAN UGH\./);
});

test('uses shared Caveman rules only for user explanations', async () => {
  const { CLI_EXPLANATION_RULES } = await import('../dist/ui/caveman.js');
  const { askAndAnalyzeIntent } = await import('../dist/contribute/intent.js');
  const { explainContributionStatus } = await import('../dist/contribute/followup.js');
  const { LLMDescriber } = await import('../dist/describers/llm-describer.js');
  const { suggestBranchName, suggestCommitMessage } = await import('../dist/contribute/workflow.js');
  const { checkLLMConnection } = await import('../dist/contribute/llm.js');
  const original = globalThis.fetch;
  const prompts = [];
  let reply = '1. [MUST] Run tests.';
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/search/issues')) return new Response(JSON.stringify({ items: [] }), { headers: { 'content-type': 'application/json' } });
    prompts.push(JSON.parse(init.body).prompt);
    return new Response(JSON.stringify({ response: reply }));
  };
  try {
    const source = 'Run `npm test -- --runInBand`. Do not edit `/tmp/source.ts`.';
    await askAndAnalyzeIntent({ raw: source }, { upstreamOwner: 'owner', upstreamRepo: 'repo' }, config, 'Fix tests');
    await explainContributionStatus({ pr: { url: 'https://github.com/owner/repo/pull/1' }, feedback: [{ text: source }] }, config);
    await new LLMDescriber(config).describe({ name: 'tool', description: source, language: 'TypeScript', topics: [] });
    for (const prompt of prompts) {
      assert.ok(prompt.includes(CLI_EXPLANATION_RULES));
      assert.ok(prompt.includes(source));
    }
    reply = 'fix/tests';
    await suggestBranchName({ raw: 'Fix tests', keywords: ['tests'] }, { branchConvention: null }, config);
    reply = 'fix: repair tests';
    await suggestCommitMessage({ raw: 'Fix tests' }, ['src/tests.ts'], config);
    reply = 'pong';
    await checkLLMConnection(config);
    for (const prompt of prompts.slice(3)) assert.ok(!prompt.includes(CLI_EXPLANATION_RULES));
    assert.equal(prompts.at(-1), 'Reply with exactly pong. No other text.');
  } finally { globalThis.fetch = original; }
});
