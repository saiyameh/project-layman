import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const config = { github_token: 'token', llm: { provider: 'ollama', api_key: null, model: 'x', base_url: 'http://localhost:11434' } };
const identity = { owner: 'cave', repo: 'tool', prNumber: 7 };

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

async function withGitHub(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    return handler(target, init);
  };
  try { return await run(); } finally { globalThis.fetch = original; }
}

function routes(overrides = {}) {
  return async (url, init) => {
    if (url.endsWith('/pulls/7')) return response({ state: 'open', merged: false, html_url: 'https://github.com/cave/tool/pull/7', head: { sha: 'head' }, merge_commit_sha: 'merge', base: { ref: 'main' }, mergeable: true });
    if (url.includes('/branches/main/protection')) return response({ required_status_checks: { contexts: ['build'] } });
    if (url.includes('/rules/branches/main')) return response([]);
    if (url.includes('/commits/head/check-runs')) return response({ total_count: 1, check_runs: [{ name: 'build', status: 'completed', conclusion: 'success', details_url: 'https://ci/head' }] });
    if (url.includes('/commits/merge/check-runs')) return response({ total_count: 1, check_runs: [{ name: 'build', status: 'completed', conclusion: 'failure', details_url: 'https://ci/merge' }] });
    if (url.includes('/commits/head/statuses')) return response([]);
    if (url.includes('/commits/merge/statuses')) return response([]);
    if (url.includes('/pulls/7/reviews')) return response([{ state: 'CHANGES_REQUESTED' }]);
    if (url.includes('/issues/7/comments')) return response([{ id: 1 }]);
    if (String(init.method).toUpperCase() === 'POST' && url.endsWith('/graphql')) return response({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }], pageInfo: { hasNextPage: false } } } } } });
    if (overrides[url]) return overrides[url](url, init);
    throw new Error(`unexpected request ${url}`);
  };
}

test('keeps PR head and test-merge CI evidence separate', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  await withGitHub(routes(), async () => {
    const status = await getContributionStatus(config, identity);
    assert.equal(status.access, 'available');
    assert.equal(status.ci.head.state, 'success');
    assert.equal(status.ci.testMerge.state, 'failure');
    assert.deepEqual(status.suggestedTasks, [
      'Fix checks for GitHub test-merge commit.',
      'Reply to requested review changes.',
      'Resolve inline review threads.',
    ]);
    assert.ok(status.links.includes('https://ci/head'));
    assert.ok(status.links.includes('https://ci/merge'));
  });
});

test('marks missing required checks and no CI as unknown', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  const handler = async (url, init) => {
    if (url.endsWith('/pulls/7')) return response({ state: 'open', merged: false, head: { sha: 'head' }, merge_commit_sha: 'head', base: { ref: 'main' } });
    if (url.includes('/branches/main/protection')) return response({ required_status_checks: { contexts: ['required'] } });
    if (url.includes('/rules/branches/main')) return response([]);
    if (url.includes('/commits/head/check-runs')) return response({ total_count: 0, check_runs: [] });
    if (url.includes('/commits/head/statuses')) return response([]);
    if (url.includes('/pulls/7/reviews') || url.includes('/issues/7/comments')) return response([]);
    if (String(init.method).toUpperCase() === 'POST') return response({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    throw new Error(`unexpected request ${url}`);
  };
  await withGitHub(handler, async () => {
    const status = await getContributionStatus(config, identity);
    assert.equal(status.ci.head.state, 'unknown');
    assert.match(status.suggestedTasks.join(' '), /required CI/i);
  });
});

test('does not report a denied GitHub token as success', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  await withGitHub(async () => response({ message: 'Bad credentials' }, 401), async () => {
    const status = await getContributionStatus(config, identity);
    assert.equal(status.access, 'denied');
    assert.equal(status.pr.state, 'unknown');
    assert.match(status.suggestedTasks[0], /token access/i);
  });
});

test('keeps merged and closed PRs distinct', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  for (const [merged, expected] of [[true, 'merged'], [false, 'closed']]) {
    await withGitHub(async (url) => {
      if (url.endsWith('/pulls/7')) return response({ state: 'closed', merged, head: { sha: 'head' }, base: { ref: 'main' } });
      throw new Error(`unexpected request ${url}`);
    }, async () => {
      const status = await getContributionStatus(config, identity);
      assert.equal(status.pr.state, expected);
    });
  }
});

test('uses the newest paginated check and does not hide a same-name status failure', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  await withGitHub(async (url, init) => {
    if (url.endsWith('/pulls/7')) return response({ state: 'open', merged: false, head: { sha: 'head' }, base: { ref: 'main' } });
    if (url.includes('/branches/main/protection')) return response({ required_status_checks: { contexts: ['build'] } });
    if (url.includes('/rules/branches/main')) return response([]);
    if (url.includes('/commits/head/check-runs')) {
      if (url.includes('page=2')) return response({ total_count: 2, check_runs: [{ id: 2, name: 'build', head_sha: 'head', status: 'completed', conclusion: 'success', completed_at: '2026-01-02T00:00:00Z' }] });
      return new Response(JSON.stringify({ total_count: 2, check_runs: [{ id: 1, name: 'build', head_sha: 'head', status: 'completed', conclusion: 'failure', completed_at: '2026-01-01T00:00:00Z' }] }), { headers: { link: '<https://api.github.com/repos/cave/tool/commits/head/check-runs?per_page=100&page=2>; rel="next"', 'content-type': 'application/json' } });
    }
    if (url.includes('/commits/head/statuses')) return response([{ context: 'build', state: 'failure', updated_at: '2026-01-03T00:00:00Z' }]);
    if (url.includes('/pulls/7/reviews') || url.includes('/issues/7/comments')) return response([]);
    if (String(init.method).toUpperCase() === 'POST') return response({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    const status = await getContributionStatus(config, identity);
    assert.equal(status.ci.head.checks[0].conclusion, 'success, failure');
    assert.equal(status.ci.head.state, 'failure');
  });
});

test('marks a ref unknown when GitHub returns evidence for another SHA', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  await withGitHub(async (url, init) => {
    if (url.endsWith('/pulls/7')) return response({ state: 'open', merged: false, head: { sha: 'head' }, base: { ref: 'main' } });
    if (url.includes('/branches/main/protection')) return response({ required_status_checks: { contexts: [] } });
    if (url.includes('/rules/branches/main')) return response([]);
    if (url.includes('/commits/head/check-runs')) return response({ total_count: 1, check_runs: [{ name: 'build', head_sha: 'old-head', status: 'completed', conclusion: 'success' }] });
    if (url.includes('/commits/head/statuses')) return response([]);
    if (url.includes('/pulls/7/reviews') || url.includes('/issues/7/comments')) return response([]);
    if (String(init.method).toUpperCase() === 'POST') return response({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    const status = await getContributionStatus(config, identity);
    assert.equal(status.ci.head.state, 'unknown');
    assert.equal(status.state, 'unknown');
  });
});

test('uses the latest reviewer decision and does not count an old-head approval', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  const fallback = routes();
  await withGitHub(async (url, init) => {
    if (url.includes('/pulls/7/reviews')) return response([
      { id: 1, user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', commit_id: 'old-head', body: 'Fix edge case', html_url: 'https://github.com/cave/tool/pull/7#review-1' },
      { id: 2, user: { login: 'reviewer' }, state: 'APPROVED', commit_id: 'head', body: 'Fixed', html_url: 'https://github.com/cave/tool/pull/7#review-2' },
      { id: 3, user: { login: 'other' }, state: 'APPROVED', commit_id: 'old-head' },
    ]);
    if (url.includes('/issues/7/comments')) return response([{ id: 1, user: { login: 'maintainer' }, body: 'Add a regression case.', html_url: 'https://github.com/cave/tool/pull/7#comment-1' }]);
    return fallback(url, init);
  }, async () => {
    const status = await getContributionStatus(config, identity);
    assert.equal(status.reviews.approved, 1);
    assert.equal(status.reviews.changesRequested, 0);
    assert.ok(!status.suggestedTasks.includes('Reply to requested review changes.'));
    assert.ok(status.feedback.some(item => item.text === 'Add a regression case.'));
    assert.ok(status.links.includes('https://github.com/cave/tool/pull/7#comment-1'));
  });
});

test('includes ruleset checks and waits for required current-head approvals', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  const fallback = routes();
  await withGitHub(async (url, init) => {
    if (url.includes('/rules/branches/main')) return response([
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ruleset-build' }] } },
      { type: 'pull_request', parameters: { required_approving_review_count: 2 } },
    ]);
    if (url.includes('/commits/merge/check-runs') || url.includes('/commits/head/check-runs')) return response({ total_count: 2, check_runs: ['build', 'ruleset-build'].map(name => ({ name, status: 'completed', conclusion: 'success' })) });
    if (url.includes('/pulls/7/reviews')) return response([{ user: { login: 'reviewer' }, state: 'APPROVED', commit_id: 'head' }]);
    return fallback(url, init);
  }, async () => {
    const status = await getContributionStatus(config, identity);
    assert.deepEqual(status.branchRules.requiredChecks, ['build', 'ruleset-build']);
    assert.equal(status.branchRules.requiredApprovals, 2);
    assert.equal(status.state, 'waiting');
    assert.ok(status.suggestedTasks.some(task => /approval/i.test(task)));
  });
});

test('keeps effective rules unknown when the ruleset request fails', async () => {
  const { getContributionStatus } = await import('../dist/contribute/followup.js');
  const fallback = routes();
  await withGitHub(async (url, init) => url.includes('/rules/branches/main') ? response({ message: 'Denied' }, 403) : fallback(url, init), async () => {
    const status = await getContributionStatus(config, identity);
    assert.equal(status.branchRules.state, 'unknown');
    assert.equal(status.state, 'unknown');
  });
});

test('status UI preserves skipped, neutral, missing, and terminal evidence', async () => {
  const { showStatus } = await import('../dist/contribute/workflow.js');
  const { newSession } = await import('../dist/contribute/state.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-status-ui-'));
  const originalHome = os.homedir;
  const originalLog = console.log;
  const lines = [];
  os.homedir = () => home;
  console.log = value => lines.push(String(value));
  const session = newSession('/repo', 'main', {}, 'base');
  session.branch = 'fix/checks';
  session.ctx = { upstreamOwner: 'cave', upstreamRepo: 'tool' };
  session.prNumber = 7;
  const fallback = routes();
  try {
    await withGitHub(async (url, init) => {
      if (url.includes('/check-runs')) return response({ total_count: 2, check_runs: [
        { name: 'optional', status: 'completed', conclusion: 'skipped' },
        { name: 'analysis', status: 'completed', conclusion: 'neutral' },
      ] });
      if (url.includes('/pulls/7/reviews')) return response([]);
      return fallback(url, init);
    }, async () => assert.equal(await showStatus(session, config), 'published'));
    const output = lines.join('\n');
    assert.match(output, /0 passed/);
    assert.match(output, /\[SKIP\] Head: optional/);
    assert.match(output, /\[\?\] Head: analysis \(neutral\)/);
    assert.match(output, /Contribution state: unknown/);
    assert.match(output, /Head CI: unknown/);
    assert.match(output, /Next: Inspect the listed unknown evidence, then run layman --status --contribute '\/repo'\./);
    lines.length = 0;
    await withGitHub(async () => response({ state: 'closed', merged: true, head: { sha: 'head' }, base: { ref: 'main' } }),
      async () => assert.equal(await showStatus(session, config), 'merged'));
    assert.match(lines.join('\n'), /Step 7 of 7: Finish contribution/);
    assert.match(lines.join('\n'), /Next: Run layman --cleanup --contribute '\/repo' when you are ready\./);
  } finally {
    os.homedir = originalHome;
    console.log = originalLog;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
