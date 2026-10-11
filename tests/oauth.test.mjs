import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

const auth = () => import('../dist/auth/openai.js');

function jwt(privateKey, clientId, nonce, changes = {}) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: clientId, sub: 'user-1', nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, ...changes })).toString('base64url');
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('builds a new registration with PKCE and fixed loopback callback', async () => {
  const { createOpenAIAttempt, buildOpenAIAuthorizeUrl } = await auth();
  const attempt = createOpenAIAttempt('urn:uuid:host', 1455);
  const url = new URL(buildOpenAIAuthorizeUrl(attempt));
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:1455/auth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('state'));
  assert.ok(url.searchParams.get('nonce'));
});

test('rejects callback cancellation, wrong state, and changed client registration', async () => {
  const { createOpenAIAttempt, readOpenAICallback } = await auth();
  const attempt = createOpenAIAttempt('urn:uuid:host', 1455, { client_id: 'oaiapp_saved' });
  assert.throws(() => readOpenAICallback(new URL('http://127.0.0.1:1455/auth/callback?error=access_denied&state=bad'), attempt), /state/i);
  assert.throws(() => readOpenAICallback(new URL(`http://127.0.0.1:1455/auth/callback?error=access_denied&state=${attempt.state}`), attempt), /cancelled/i);
  assert.throws(() => readOpenAICallback(new URL(`http://127.0.0.1:1455/wrong?code=x&state=${attempt.state}&client_id=oaiapp_other`), attempt), /callback/i);
  assert.throws(() => readOpenAICallback(new URL(`http://127.0.0.1:1455/auth/callback?code=x&state=${attempt.state}&client_id=oaiapp_other`), attempt), /wrong/i);
});

test('verifies OpenAI ID-token signature, issuer, audience, and nonce', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { verifyOpenAIIdentity } = await auth();
  const run = (changes = {}) => withFetch(async () => new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', kty: 'RSA' }] })), async () => verifyOpenAIIdentity(jwt(privateKey, 'oaiapp_1', 'nonce-1', changes), 'oaiapp_1', 'nonce-1'));
  assert.deepEqual(await run({ email: 'cave@example.com' }), { subject: 'user-1', email: 'cave@example.com' });
  await assert.rejects(run({ iss: 'https://wrong.example' }), /identity/i);
  await assert.rejects(run({ aud: 'oaiapp_other' }), /identity/i);
  await assert.rejects(run({ nonce: 'other' }), /identity/i);
  await assert.rejects(run({ iat: Math.floor(Date.now() / 1000) + 60 }), /identity/i);
  await assert.rejects(run({ nbf: Math.floor(Date.now() / 1000) + 60 }), /identity/i);
  await assert.rejects(run({ exp: Math.floor(Date.now() / 1000) - 60 }), /identity/i);
});

test('requires plan scope and keeps the old account binding', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { createOpenAIAttempt, makeOpenAIConnection } = await auth();
  const attempt = createOpenAIAttempt('urn:uuid:host', 1455);
  const tokens = { id_token: jwt(privateKey, 'oaiapp_1', attempt.nonce), access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' };
  await withFetch(async () => new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', kty: 'RSA' }] })), async () => {
    const connection = await makeOpenAIConnection(tokens, attempt, 'oaiapp_1');
    assert.equal(connection.subject, 'user-1');
    await assert.rejects(makeOpenAIConnection({ ...tokens, scope: 'openid' }, attempt, 'oaiapp_1'), /plan use/i);
    await assert.rejects(makeOpenAIConnection({ ...tokens, id_token: jwt(privateKey, 'oaiapp_1', attempt.nonce, { sub: 'user-2' }) }, attempt, 'oaiapp_1', connection), /different/i);
  });
});

test('refresh rejects incomplete credentials without exposing token data', async () => {
  const { refreshOpenAIConnection } = await auth();
  const connection = { host_id: 'urn:uuid:host', client_id: 'oaiapp_1', subject: 'user', email: null, id_token: 'id-secret', access_token: 'access-secret', refresh_token: 'refresh-secret', expires_at: 0, scopes: ['chatgpt.tokens.use.direct'] };
  await withFetch(async () => new Response(JSON.stringify({ access_token: 'new-secret' })), async () => {
    await assert.rejects(refreshOpenAIConnection(connection), error => !/secret/.test(error.message));
  });
});

test('refresh rotates credentials once and rejects changed accounts or revoked scopes', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { refreshOpenAIConnection } = await auth();
  const connection = { host_id: 'urn:uuid:host', client_id: 'oaiapp_1', subject: 'user-1', email: null, id_token: 'old-id', access_token: 'old-access', refresh_token: 'old-refresh', expires_at: 0, scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'] };
  let requests = 0;
  let changes = {};
  let scope;
  await withFetch(async (url, init) => {
    if (String(url).includes('jwks')) return new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key' }] }));
    requests++;
    assert.equal(init.body.get('grant_type'), 'refresh_token');
    assert.equal(init.body.get('refresh_token'), 'old-refresh');
    return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, id_token: jwt(privateKey, connection.client_id, undefined, changes), scope }));
  }, async () => {
    const [first, second] = await Promise.all([refreshOpenAIConnection(connection), refreshOpenAIConnection(connection)]);
    assert.equal(requests, 1);
    assert.deepEqual(first, second);
    assert.equal(first.access_token, 'new-access');
    assert.equal(first.refresh_token, 'new-refresh');
    assert.ok(first.expires_at > Date.now());
    assert.equal(connection.refresh_token, 'old-refresh');
    changes = { sub: 'different-user' };
    await assert.rejects(refreshOpenAIConnection(connection), /different account/i);
    scope = 'openid';
    await assert.rejects(refreshOpenAIConnection(connection), /no longer approved/i);
  });
});
