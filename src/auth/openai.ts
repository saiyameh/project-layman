import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';

export const OPENAI_ISSUER = 'https://auth.openai.com';
export const OPENAI_AUTHORIZE_URL = `${OPENAI_ISSUER}/api/accounts/authorize`;
export const OPENAI_TOKEN_URL = `${OPENAI_ISSUER}/api/accounts/oauth/token`;
export const OPENAI_JWKS_URL = `${OPENAI_ISSUER}/.well-known/jwks.json`;
export const OPENAI_RESOURCE = 'https://api.openai.com/v1';
export const OPENAI_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'] as const;

export interface OpenAIOAuthConnection {
  host_id: string;
  client_id: string;
  subject: string;
  email: string | null;
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string[];
}

export interface OpenAIOAuthAttempt {
  state: string;
  nonce: string;
  code_verifier: string;
  redirect_uri: string;
  client_id: string;
  host_id: string;
  is_new: boolean;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

const refreshes = new Map<string, Promise<OpenAIOAuthConnection>>();

function randomValue(): string { return randomBytes(32).toString('base64url'); }
function words(value: unknown): string[] { return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []; }

export function createOpenAIHostId(): string { return `urn:uuid:${randomUUID()}`; }

export function createOpenAIAttempt(hostId: string, port: number, connection?: OpenAIOAuthConnection): OpenAIOAuthAttempt {
  const code_verifier = randomValue();
  return {
    state: randomValue(), nonce: randomValue(), code_verifier,
    redirect_uri: `http://127.0.0.1:${port}/auth/callback`,
    client_id: connection?.client_id || 'dynamic_agent_client', host_id: hostId,
    is_new: !connection,
  };
}

export function buildOpenAIAuthorizeUrl(attempt: OpenAIOAuthAttempt, connection?: OpenAIOAuthConnection): string {
  const params = new URLSearchParams({
    client_id: attempt.client_id, response_type: 'code', redirect_uri: attempt.redirect_uri,
    scope: OPENAI_SCOPES.join(' '), resource: OPENAI_RESOURCE, state: attempt.state,
    nonce: attempt.nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(attempt.code_verifier).digest('base64url'),
    ext_agent_host_id: attempt.host_id,
  });
  if (attempt.is_new) params.set('agent_name_hint', 'Project Layman');
  if (connection?.id_token) params.set('id_token_hint', connection.id_token);
  if (connection?.email) params.set('login_hint', connection.email);
  return `${OPENAI_AUTHORIZE_URL}?${params}`;
}

export function readOpenAICallback(callback: URL, attempt: OpenAIOAuthAttempt): { code: string; clientId: string } {
  const redirect = new URL(attempt.redirect_uri);
  if (callback.protocol !== redirect.protocol || callback.hostname !== redirect.hostname || callback.port !== redirect.port || callback.pathname !== redirect.pathname) {
    throw new Error('ChatGPT sign-in returned to the wrong callback. Try again.');
  }
  if (callback.searchParams.get('state') !== attempt.state) throw new Error('ChatGPT sign-in state did not match. Try again.');
  if (callback.searchParams.has('error')) throw new Error('ChatGPT sign-in was cancelled.');
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('ChatGPT sign-in gave no code. Try again.');
  const returnedClientId = callback.searchParams.get('client_id');
  if (attempt.is_new && (!returnedClientId || !returnedClientId.startsWith('oaiapp_'))) {
    throw new Error('ChatGPT did not finish app registration. Try again.');
  }
  if (!attempt.is_new && returnedClientId && returnedClientId !== attempt.client_id) {
    throw new Error('ChatGPT returned the wrong app registration. Try again.');
  }
  return { code, clientId: returnedClientId || attempt.client_id };
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(OPENAI_TOKEN_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(30000) });
  } catch { throw new Error('ChatGPT sign-in connection failed. Try again.'); }
  if (!response.ok) throw new Error('ChatGPT token request failed. Try again.');
  try { return await response.json() as TokenResponse; } catch { throw new Error('ChatGPT sent an invalid token response. Try again.'); }
}

export async function exchangeOpenAICode(code: string, attempt: OpenAIOAuthAttempt, clientId: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.code_verifier, redirect_uri: attempt.redirect_uri, resource: OPENAI_RESOURCE }));
}

function decodePart(value: string): Record<string, unknown> {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>; }
  catch { throw new Error('ChatGPT sent an invalid identity token.'); }
}

export async function verifyOpenAIIdentity(idToken: string, clientId: string, nonce?: string): Promise<{ subject: string; email: string | null }> {
  const [headerPart, payloadPart, signaturePart, ...extra] = idToken.split('.');
  if (!headerPart || !payloadPart || !signaturePart || extra.length) throw new Error('ChatGPT sent an invalid identity token.');
  const header = decodePart(headerPart);
  const payload = decodePart(payloadPart);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('ChatGPT identity token uses an unsupported signature.');
  let jwks: { keys?: Array<Record<string, unknown>> };
  try {
    const response = await fetch(OPENAI_JWKS_URL, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error();
    jwks = await response.json() as { keys?: Array<Record<string, unknown>> };
  } catch { throw new Error('Could not verify ChatGPT identity. Try again.'); }
  const key = jwks.keys?.find(candidate => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!key) throw new Error('Could not verify ChatGPT identity. Try again.');
  let valid = false;
  try { valid = verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(signaturePart, 'base64url')); }
  catch { throw new Error('Could not verify ChatGPT identity. Try again.'); }
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!valid || payload.iss !== OPENAI_ISSUER || !audience.includes(clientId) || (audience.length > 1 && payload.azp !== clientId) || typeof payload.exp !== 'number' || payload.exp <= now - 5 || typeof payload.iat !== 'number' || payload.iat > now + 5 || (typeof payload.nbf === 'number' && payload.nbf > now + 5) || (nonce !== undefined && payload.nonce !== nonce) || typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('ChatGPT identity check failed. Try again.');
  }
  return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
}

export async function makeOpenAIConnection(tokens: TokenResponse, attempt: OpenAIOAuthAttempt, clientId: string, previous?: OpenAIOAuthConnection): Promise<OpenAIOAuthConnection> {
  if (typeof tokens.id_token !== 'string' || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new Error('ChatGPT gave incomplete credentials. Try again.');
  }
  const scopes = words(tokens.scope);
  if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) throw new Error('ChatGPT plan use was not approved. Use an API key or sign in again.');
  const identity = await verifyOpenAIIdentity(tokens.id_token, clientId, attempt.nonce);
  if (previous && previous.subject !== identity.subject) throw new Error('This is a different ChatGPT account. Use the saved account. The previous connection stays unchanged.');
  return { host_id: attempt.host_id, client_id: clientId, subject: identity.subject, email: identity.email, id_token: tokens.id_token, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + tokens.expires_in * 1000, scopes };
}

async function refresh(connection: OpenAIOAuthConnection): Promise<OpenAIOAuthConnection> {
  const tokens = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: connection.client_id, refresh_token: connection.refresh_token, resource: OPENAI_RESOURCE }));
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('ChatGPT refresh gave incomplete credentials. Sign in again.');
  const scopes = words(tokens.scope || connection.scopes.join(' '));
  if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) throw new Error('ChatGPT plan use is no longer approved. Sign in again.');
  let identity: { subject: string; email: string | null } | undefined;
  if (typeof tokens.id_token === 'string') identity = await verifyOpenAIIdentity(tokens.id_token, connection.client_id);
  if (identity && identity.subject !== connection.subject) throw new Error('ChatGPT refresh returned a different account. Sign in again.');
  return { ...connection, ...(identity?.email ? { email: identity.email } : {}), ...(typeof tokens.id_token === 'string' ? { id_token: tokens.id_token } : {}), access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + tokens.expires_in * 1000, scopes };
}

export function refreshOpenAIConnection(connection: OpenAIOAuthConnection): Promise<OpenAIOAuthConnection> {
  const key = `${connection.client_id}:${connection.subject}`;
  const current = refreshes.get(key);
  if (current) return current;
  const pending = refresh(connection).finally(() => refreshes.delete(key));
  refreshes.set(key, pending);
  return pending;
}

function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => reject(new Error('Could not open a browser for ChatGPT sign-in. Try again.')));
    child.once('spawn', resolve);
    child.unref();
  });
}

export async function signInWithChatGPT(existing?: OpenAIOAuthConnection): Promise<OpenAIOAuthConnection> {
  const hostId = existing?.host_id || createOpenAIHostId();
  const server = http.createServer();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const callback = new Promise<{ url: URL; response: http.ServerResponse }>((resolve, reject) => {
    let consumed = false;
    timer = setTimeout(() => reject(new Error('ChatGPT sign-in timed out. Try again.')), 10 * 60 * 1000);
    server.on('request', (request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/auth/callback') { response.writeHead(404).end(); return; }
      if (consumed) { response.writeHead(409).end(); return; }
      consumed = true;
      resolve({ url: new URL(url.pathname + url.search, `http://127.0.0.1:${(server.address() as { port: number }).port}`), response });
    });
    server.once('error', reject);
  });
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  try {
    const attempt = createOpenAIAttempt(hostId, (server.address() as { port: number }).port, existing);
    await openBrowser(buildOpenAIAuthorizeUrl(attempt, existing));
    const received = await callback;
    try {
      const result = readOpenAICallback(received.url, attempt);
      const connection = await makeOpenAIConnection(await exchangeOpenAICode(result.code, attempt, result.clientId), attempt, result.clientId, existing);
      received.response.writeHead(200, { 'Content-Type': 'text/plain' });
      received.response.end('Model connected. You can close this tab.');
      return connection;
    } catch (error) {
      received.response.writeHead(400, { 'Content-Type': 'text/plain' });
      received.response.end('Model not connected. Return to Layman.');
      throw error;
    }
  } finally { if (timer) clearTimeout(timer); server.close(); }
}
