import fs from 'node:fs';
import os from 'node:os';

const input = JSON.parse(process.env.LAYMAN_WORKFLOW_INPUT);
const messages = [];
console.log = (...args) => messages.push(args.join(' '));
os.homedir = () => input.home;

const requests = [];
const modelPrompts = [];
const prs = input.prs ?? [];
let creates = 0;
let updates = 0;
let lost = input.mode === 'lost-pr';
let rejected = ['rejected-pr', 'rejected-issue'].includes(input.mode);
const pr = (body, number = 41, login = 'fork') => ({
  number,
  html_url: `https://github.com/acme/upstream/pull/${number}`,
  body,
  state: 'open',
  merged_at: null,
  user: { login },
  head: { ref: 'feat/test', repo: { name: 'repo', owner: { login: 'fork' } } },
  base: { ref: 'main' },
});

globalThis.fetch = async (url, init = {}) => {
  const requestUrl = String(url);
  const method = init.method ?? 'GET';
  requests.push(`${method} ${requestUrl}`);
  if (requestUrl === 'http://localhost:11434/api/generate') {
    const prompt = JSON.parse(init.body).prompt;
    modelPrompts.push(prompt);
    const answer = prompt.startsWith('Read repository policy text')
      ? { requirements: [{ text: 'Review the contribution scope.', kind: 'conditional', sourceId: 'rules', excerpt: 'Review the contribution scope.', action: 'manual' }] }
      : { commit: 'feat: add file', title: 'Add file', body: '## Summary\nAdd file' };
    return new Response(JSON.stringify({ response: prompt === 'Reply with exactly pong. No other text.' ? 'pong' : prompt.startsWith('Draft a GitHub issue') ? '## Description\nAdd file' : JSON.stringify(answer) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (requestUrl.endsWith('/user')) return new Response(JSON.stringify({ login: 'fork' }), { headers: { 'content-type': 'application/json' } });
  if (requestUrl.endsWith('/repos/fork/repo')) return new Response(JSON.stringify({ owner: { login: 'fork' }, name: 'repo', fork: false, permissions: { push: true }, default_branch: 'main', archived: false, disabled: false }), { headers: { 'content-type': 'application/json' } });
  if (requestUrl.includes('/contents') || requestUrl.endsWith('/repos/fork/.github')) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  if (requestUrl.includes('/search/issues')) return new Response(JSON.stringify({ items: [] }), { headers: { 'content-type': 'application/json' } });
  if (/\/issues(?:\?|$)/.test(requestUrl)) {
    if (method === 'GET') return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } });
    if (rejected) { rejected = false; return new Response(JSON.stringify({ message: 'Validation failed' }), { status: 422, headers: { 'content-type': 'application/json' } }); }
    creates++;
    return new Response(JSON.stringify({ number: 12, html_url: 'https://github.com/acme/upstream/issues/12' }), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  if (requestUrl.endsWith('/branches/main')) return new Response(JSON.stringify({ name: 'main' }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (requestUrl.includes('/pulls')) {
    if (method === 'GET') return new Response(JSON.stringify(/\/pulls\/\d+$/.test(requestUrl) ? prs[0] : prs), { status: 200, headers: { 'content-type': 'application/json' } });
    if (method === 'POST') {
      if (rejected) { rejected = false; return new Response(JSON.stringify({ message: 'Validation failed' }), { status: 422, headers: { 'content-type': 'application/json' } }); }
      creates++;
      const body = JSON.parse(init.body);
      prs.push(pr(body.body));
      if (lost) { lost = false; throw new TypeError('response lost'); }
      return new Response(JSON.stringify(prs.at(-1)), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    updates++;
    return new Response(JSON.stringify(prs[0] ?? pr('')), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected request: ${method} ${requestUrl}`);
};

const config = {
  github_token: 'github-token', description_mode: 'llm',
  llm: { provider: 'ollama', api_key: null, model: 'test-model', base_url: 'http://localhost:11434' },
  editor: 'code', editor_command: 'code', workspace_dir: input.repo, default_result_count: 10, clone_protocol: 'https',
};
const ctx = {
  repoPath: input.repo, branch: 'feat/test', upstreamOwner: 'acme', upstreamRepo: 'upstream',
  forkOwner: 'fork', pushOwner: 'fork', pushRepo: 'repo', defaultBranch: 'main', baseSha: input.baseSha,
};
let guide = { raw: '', hasCodeOfConduct: false, setupSteps: [], testCommand: null, branchConvention: null, prTemplate: null, prTargetBranch: null, requiredChecks: [], issueRequired: false, signOffRequired: false, licenseAgreement: null, source: 'defaults', sourcePath: null, requirements: [], commands: [] };
const intent = { raw: 'add file', keywords: ['file'], checklist: '' };
const state = await import('../../dist/contribute/state.js');
const workflow = await import('../../dist/contribute/workflow.js');

const session = state.newSession(input.repo, 'main', { origin: 'git@github.com:fork/repo.git' }, input.baseSha);
session.branch = 'feat/test';
session.branchCreated = true;
session.stage = 'coding';
session.ctx = ctx;
session.guide = guide;
session.intent = intent;
session.rawIntent = intent.raw;
state.saveSession(session);

let firstError = null;
let recoveredError = null;
let outcome;
try {
  if (input.mode === 'matrix') {
    const { interpretPolicy } = await import('../../dist/contribute/policy.js');
    guide = await interpretPolicy({ ...guide, raw: 'Review the contribution scope.', sources: [{ id: 'rules', path: 'CONTRIBUTING.md', ref: input.baseSha, status: 'found', content: 'Review the contribution scope.', excerpt: 'Review the contribution scope.' }] }, config, intent);
    session.stage = 'preparing';
    session.branchCreated = false;
    await workflow.runWorkflow(ctx, guide, intent, [], session.branch, config, session, 'prepare');
    fs.writeFileSync(`${input.repo}/new.txt`, 'new\n');
    await workflow.runWorkflow(ctx, guide, intent, [], session.branch, config, session, 'check');
  }
  if (input.mode === 'check-summary') {
    guide = { ...guide, commands: [{ command: 'node -e "console.log(\'check output\')"', kind: 'check' }] };
    session.guide = guide;
    state.saveSession(session);
    outcome = await workflow.runWorkflow(ctx, guide, intent, [], session.branch, config, session, 'check');
  } else if (input.mode === 'target-advanced') {
    const { readContributionGuide } = await import('../../dist/contribute/reader.js');
    session.ctx = { ...ctx, upstreamOwner: 'fork', upstreamRepo: 'repo', baseRemote: 'origin' };
    session.guide = await readContributionGuide(session.ctx, config);
    session.policyInterpretedHash = session.guide.policyHash;
    session.briefPath = 'existing brief';
    state.saveSession(session);
    const { runContributeFlow } = await import('../../dist/contribute/index.js');
    await runContributeFlow(config, input.repo, false, { operation: 'check' });
    outcome = 'prepared';
  } else if (input.mode === 'rejected-issue') {
    const { ensureIssue } = await import('../../dist/contribute/submission.js');
    try { await ensureIssue(session, config); }
    catch (error) {
      recoveredError = error.message;
      const resumed = state.loadSessions().find(item => item.id === session.id);
      await ensureIssue(resumed, config);
    }
    outcome = 'prepared';
  } else if (input.mode.startsWith('undo-')) {
    if (input.mode === 'undo-changed') prs[0].body = `<!-- layman-contribution:${session.id} -->`;
    session.prNumber = 41;
    session.prCreated = true;
    state.saveSession(session);
    await workflow.runUndo(input.repo, config);
  } else {
    try {
      outcome = await workflow.runWorkflow(ctx, guide, intent, [], session.branch, config, session, 'submit');
    } catch (error) {
      if (!['lost-pr', 'retry-push', 'rejected-pr'].includes(input.mode)) throw error;
      recoveredError = error.message;
      const resumed = state.loadSessions().find(item => item.id === session.id);
      outcome = await workflow.runWorkflow(ctx, guide, intent, [], resumed.branch, config, resumed, 'submit');
    }
  }
} catch (error) {
  firstError = error instanceof Error ? error.message : String(error);
}
const saved = state.loadSessions().find(item => item.id === session.id);
process.stdout.write(JSON.stringify({ outcome, error: firstError, recoveredError, creates, updates, requests, modelPrompts, messages, session: saved }));
