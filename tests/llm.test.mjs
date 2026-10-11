import assert from 'node:assert/strict';
import test from 'node:test';

const config = (llm) => ({ llm });
const ollama = (overrides = {}) => config({
  provider: 'ollama',
  api_key: null,
  model: 'llama3.2',
  base_url: 'http://localhost:11434',
  ...overrides,
});
const openai = (overrides = {}) => config({
  provider: 'openai',
  api_key: 'test-openai-key',
  model: null,
  base_url: null,
  ...overrides,
});
const anthropic = (overrides = {}) => config({
  provider: 'anthropic',
  api_key: 'test-anthropic-key',
  model: null,
  base_url: null,
  ...overrides,
});
const compatible = (overrides = {}) => config({
  provider: 'openai-compatible',
  api_key: null,
  model: 'local-model',
  base_url: 'http://localhost:1234/v1',
  ...overrides,
});

async function withFetch(fetchMock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function loadLLM() {
  return import('../dist/contribute/llm.js');
}

test('uses OAuth Responses streams and rejects incomplete or failed output', async () => {
  const { callLLM } = await loadLLM();
  const oauth = { host_id: 'urn:uuid:host', client_id: 'oaiapp_1', subject: 'user-1', id_token: 'id-token', access_token: 'access-token', refresh_token: 'refresh-token', expires_at: Date.now() + 3600000, scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'] };
  const connected = openai({ api_key: null, oauth });
  let events = [{ type: 'response.output_text.delta', delta: 'pong' }, { type: 'response.completed' }];
  await withFetch(async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization, 'Bearer access-token');
    assert.equal(JSON.parse(init.body).store, false);
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    assert.equal(await callLLM(connected, 'Reply pong'), 'pong');
    events = [{ type: 'response.output_text.delta', delta: 'partial' }];
    await assert.rejects(callLLM(connected, 'Reply pong'));
    events = [{ type: 'response.failed' }];
    await assert.rejects(callLLM(connected, 'Reply pong'));
    events = [{ type: 'response.completed' }];
    await assert.rejects(callLLM(connected, 'Reply pong'));
  });
});

test('reports invalid provider configurations before any request', async () => {
  const { getLLMConfigError } = await loadLLM();

  assert.ok(getLLMConfigError({ provider: null, api_key: null, model: null, base_url: null }));
  assert.ok(getLLMConfigError({ provider: 'anthropic', api_key: null, model: null, base_url: null }));
  assert.equal(getLLMConfigError({ provider: 'anthropic', api_key: 'key', model: null, base_url: null }), null);
  assert.ok(getLLMConfigError({ provider: 'openai', api_key: null, model: null, base_url: null }));
  assert.equal(getLLMConfigError({ provider: 'openai', api_key: 'key', model: null, base_url: null }), null);
  assert.ok(getLLMConfigError({ provider: 'ollama', api_key: null, model: null, base_url: null }));
  assert.equal(getLLMConfigError({ provider: 'ollama', api_key: null, model: 'llama3.2', base_url: null }), null);
  assert.ok(getLLMConfigError({ provider: 'openai-compatible', api_key: null, model: null, base_url: 'http://localhost:8080/v1' }));
  assert.equal(getLLMConfigError({ provider: 'openai-compatible', api_key: null, model: 'local', base_url: 'http://localhost:8080/v1' }), null);
  assert.ok(getLLMConfigError({ provider: 'openai-compatible', api_key: null, model: 'local', base_url: null }));
  assert.ok(getLLMConfigError({ provider: 'ollama', api_key: null, model: 'llama3.2', base_url: 'http://example.com' }));
  assert.ok(getLLMConfigError({ provider: 'ollama', api_key: null, model: 'llama3.2', base_url: 'https://user:pass@example.com' }));
  assert.ok(getLLMConfigError({ provider: 'ollama', api_key: null, model: 'llama3.2', base_url: 'https://example.com/?secret=yes' }));
  assert.ok(getLLMConfigError({ provider: 'ollama', api_key: null, model: 'llama3.2', base_url: 'https://example.com/#fragment' }));
});

test('rejects invalid configuration before contacting a provider', async () => {
  const { callLLM } = await loadLLM();
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return new Response('{}');
  }, async () => {
    await assert.rejects(callLLM(ollama({ model: null }), 'private prompt'), /model/i);
  });
  assert.equal(calls, 0);
});

test('normalizes trailing slashes and returns Ollama text', async () => {
  const { callLLM } = await loadLLM();
  let url;
  await withFetch(async (request) => {
    url = String(request);
    return new Response(JSON.stringify({ response: '  cave answer  ' }), { status: 200 });
  }, async () => {
    assert.equal(await callLLM(ollama({ base_url: 'http://localhost:11434/' }), 'say cave'), 'cave answer');
  });
  assert.equal(url, 'http://localhost:11434/api/generate');
});

test('rejects malformed, empty, and invalid output without exposing provider response bodies', async () => {
  const { callLLM } = await loadLLM();
  for (const body of ['{invalid json', JSON.stringify({}), JSON.stringify({ response: '' })]) {
    await withFetch(async () => new Response(body, { status: 200 }), async () => {
      await assert.rejects(
        callLLM(ollama(), 'prompt that must stay private'),
        (error) => {
          assert.match(error.message, /LLM/i);
          assert.doesNotMatch(error.message, /prompt that must stay private|invalid json/i);
          return true;
        },
      );
    });
  }
});

test('does not retry a rejected Ollama request or reveal its body', async () => {
  const { callLLM } = await loadLLM();
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return new Response('credential or provider diagnostic', { status: 401 });
  }, async () => {
    await assert.rejects(
      callLLM(ollama(), 'hidden prompt'),
      (error) => {
        assert.doesNotMatch(error.message, /credential|provider diagnostic|hidden prompt/i);
        return true;
      },
    );
  });
  assert.equal(calls, 1);
});

test('retries a transient Ollama failure once and succeeds', async () => {
  const { callLLM } = await loadLLM();
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return calls === 1
      ? new Response('', { status: 503 })
      : new Response(JSON.stringify({ response: 'ready' }), { status: 200 });
  }, async () => {
    assert.equal(await callLLM(ollama(), 'retry'), 'ready');
  });
  assert.equal(calls, 2);
});

test('connection check accepts pong and rejects another reply', async () => {
  const { checkLLMConnection } = await loadLLM();
  await withFetch(async () => new Response(JSON.stringify({ response: ' PONG\n' }), { status: 200 }), async () => {
    await checkLLMConnection(ollama());
  });
  await withFetch(async () => new Response(JSON.stringify({ response: 'ready' }), { status: 200 }), async () => {
    await assert.rejects(checkLLMConnection(ollama()), /pong/i);
  });
});

test('uses native OpenAI, Anthropic, and compatible providers without changing providers', async () => {
  const { callLLM } = await loadLLM();
  const cases = [
    [openai(), { choices: [{ message: { role: 'assistant', content: 'openai text' } }] }, 'openai text'],
    [anthropic(), {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'anthropic text' }], usage: { input_tokens: 1, output_tokens: 1 },
    }, 'anthropic text'],
    [compatible(), { choices: [{ message: { role: 'assistant', content: 'compatible text' } }] }, 'compatible text'],
  ];

  for (const [providerConfig, payload, expected] of cases) {
    let calls = 0;
    await withFetch(async () => {
      calls++;
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }, async () => {
      assert.equal(await callLLM(providerConfig, 'provider prompt'), expected);
    });
    assert.equal(calls, 1);
  }
});

test('does not retry or leak provider error bodies for SDK transports', async () => {
  const { callLLM } = await loadLLM();
  for (const providerConfig of [openai(), anthropic(), compatible()]) {
    let calls = 0;
    await withFetch(async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'provider secret diagnostic' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }, async () => {
      await assert.rejects(
        callLLM(providerConfig, 'private provider prompt'),
        (error) => {
          assert.doesNotMatch(error.message, /provider secret diagnostic|private provider prompt|test-(openai|anthropic)-key/i);
          return true;
        },
      );
    });
    assert.equal(calls, 1);
  }
});

test('retries an SDK-wrapped network failure once', async () => {
  const { callLLM } = await loadLLM();
  let calls = 0;
  await withFetch(async () => {
    calls++;
    if (calls === 1) throw new TypeError('socket closed');
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'reconnected' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }, async () => {
    assert.equal(await callLLM(openai(), 'retry network'), 'reconnected');
  });
  assert.equal(calls, 2);
});

test('branch and commit suggestions stop when the compulsory brain rejects the request', async () => {
  const { suggestBranchName, suggestCommitMessage } = await import('../dist/contribute/workflow.js');
  await withFetch(async () => new Response('provider diagnostic', { status: 401 }), async () => {
    await assert.rejects(
      suggestBranchName(
        { raw: 'fix cave', keywords: ['fix', 'cave'], checklist: '' },
        { branchConvention: null },
        ollama(),
      ),
      /login failed/i,
    );
    await assert.rejects(
      suggestCommitMessage({ raw: 'fix cave', keywords: ['fix', 'cave'], checklist: '' }, ['src/cave.ts'], ollama()),
      /login failed/i,
    );
  });
});

test('blocks known credentials and recognizable secrets before sending model context', async () => {
  const { callLLM } = await loadLLM();
  const configured = { ...ollama(), github_token: 'configured-github-credential', llm: { ...ollama().llm, oauth: { access_token: 'configured-oauth-credential' } } };
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error('must not send'); }, async () => {
    for (const prompt of [configured.github_token, configured.llm.oauth.access_token, `ghp_${'A'.repeat(36)}`, `AKIA${'A'.repeat(16)}`]) {
      await assert.rejects(callLLM(configured, `untrusted source: ${prompt}`), /possible secret/);
    }
  });
  assert.equal(calls, 0);
});

test('search descriptions use the shared provider and retain script fallback', async () => {
  const { LLMDescriber } = await import('../dist/describers/llm-describer.js');
  const { ScriptDescriber } = await import('../dist/describers/script-describer.js');
  const repo = { name: 'tool', description: 'A tool', language: 'TypeScript', topics: [] };
  const describer = new LLMDescriber(ollama());
  await withFetch(async () => new Response(JSON.stringify({ response: 'Build tools.' })), async () => {
    assert.equal(await describer.describe(repo), 'Build tools.');
  });
  await withFetch(async () => new Response('', { status: 401 }), async () => {
    assert.equal(await describer.describe(repo), await new ScriptDescriber().describe(repo));
  });
});

test('blocks credentials in intent before searching GitHub for related PRs', async () => {
  const { askAndAnalyzeIntent } = await import('../dist/contribute/intent.js');
  const configured = { ...ollama(), github_token: 'configured-github-credential' };
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error('must not send'); }, async () => {
    await assert.rejects(askAndAnalyzeIntent({}, { upstreamOwner: 'cave', upstreamRepo: 'tool' }, configured, configured.github_token), /possible secret/);
  });
  assert.equal(calls, 0);
});
