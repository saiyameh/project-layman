import type { LaymanConfig } from '../config.js';
import { refreshOpenAIConnection, type OpenAIOAuthConnection } from '../auth/openai.js';

function hasOAuth(connection: unknown): connection is OpenAIOAuthConnection {
  if (!connection || typeof connection !== 'object') return false;
  const value = connection as Record<string, unknown>;
  return ['host_id', 'client_id', 'subject', 'id_token', 'access_token', 'refresh_token'].every(key => typeof value[key] === 'string' && value[key])
    && typeof value.expires_at === 'number' && Number.isFinite(value.expires_at) && Array.isArray(value.scopes) && value.scopes.every(scope => typeof scope === 'string');
}

export function getLLMConfigError(llm: LaymanConfig['llm']): string | null {
  if (!llm || !['anthropic', 'openai', 'ollama', 'openai-compatible'].includes(llm.provider ?? '')) {
    return 'LLM provider is required. Run layman --brain.';
  }
  if (llm.api_key !== null && llm.api_key !== undefined && typeof llm.api_key !== 'string') return 'LLM API key must be text. Run layman --brain.';
  if (llm.model !== null && llm.model !== undefined && typeof llm.model !== 'string') return 'LLM model must be text. Run layman --brain.';
  if (llm.base_url !== null && llm.base_url !== undefined && typeof llm.base_url !== 'string') return 'LLM base URL must be text. Run layman --brain.';
  if (llm.provider === 'openai' && llm.oauth !== undefined && !hasOAuth(llm.oauth)) {
    return 'ChatGPT sign-in details are invalid. Run layman --brain.';
  }
  if (llm.provider === 'openai' && !llm.api_key?.trim() && !hasOAuth(llm.oauth)) {
    return 'LLM API key is required. Run layman --brain.';
  }
  if (llm.provider === 'anthropic' && !llm.api_key?.trim()) return 'LLM API key is required. Run layman --brain.';
  if (['ollama', 'openai-compatible'].includes(llm.provider!) && !llm.model?.trim()) {
    return 'LLM model is required. Run layman --brain.';
  }
  if (llm.provider === 'openai-compatible' && !llm.base_url?.trim()) {
    return 'LLM base URL is required. Run layman --brain.';
  }
  if (llm.base_url) {
    try {
      const url = new URL(llm.base_url);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
          url.username || url.password || url.search || url.hash) {
        return 'LLM URL must use HTTPS or local HTTP, without login details, query, or fragment.';
      }
    } catch {
      return 'LLM base URL is invalid. Run layman --brain.';
    }
  }
  return null;
}

async function callOpenAIOAuth(config: LaymanConfig, prompt: string): Promise<string> {
  let oauth = config.llm.oauth!;
  if (oauth.expires_at <= Date.now() + 60_000) {
    oauth = await refreshOpenAIConnection(oauth);
    const { saveConfig } = await import('../config.js');
    const updated = { ...config, llm: { ...config.llm, oauth } };
    saveConfig(updated);
    config.llm.oauth = oauth;
  }
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${oauth.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.llm.model?.trim() || 'gpt-4o-mini', input: [{ role: 'user', content: prompt }], store: false, stream: true }),
      signal: AbortSignal.timeout(30000),
    });
  } catch { throw new Error('ChatGPT connection failed or timed out. Run layman --brain.'); }
  if (!response.ok || !response.body) throw Object.assign(new Error('ChatGPT request failed'), { status: response.status });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  let completed = false;
  const readEvent = (line: string): void => {
    if (!line.startsWith('data: ')) return;
    let event: { type?: unknown; delta?: unknown };
    try { event = JSON.parse(line.slice(6)) as { type?: unknown; delta?: unknown }; }
    catch { throw new Error('ChatGPT sent an invalid response stream. Run layman --brain.'); }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') output += event.delta;
    if (event.type === 'response.completed') completed = true;
    if (event.type === 'response.failed' || event.type === 'response.incomplete') throw new Error('ChatGPT could not complete the request. Run layman --brain.');
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) readEvent(line);
  }
  if (buffer) readEvent(buffer);
  if (!completed || !output.trim()) throw new Error('ChatGPT returned no completed text. Run layman --brain.');
  return output.trim();
}

export function assertSafeModelContext(config: LaymanConfig, prompt: string): void {
  const { llm } = config;
  const secrets = [config.github_token, llm?.api_key, llm?.oauth?.access_token, llm?.oauth?.refresh_token, llm?.oauth?.id_token];
  if (secrets.some(secret => typeof secret === 'string' && secret.length >= 16 && prompt.includes(secret)) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/.test(prompt)) {
    throw new Error('The model context contains a possible secret. Remove it from the policy source, template, intent, or diff before retrying.');
  }
}

export async function callLLM(config: LaymanConfig, prompt: string, maxTokens = 600): Promise<string> {
  assertSafeModelContext(config, prompt);
  const { llm } = config;
  const configError = getLLMConfigError(llm);
  if (configError) throw new Error(configError);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let output: unknown;
      if (llm.provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: llm.api_key!.trim(), timeout: 30000, maxRetries: 0, fetch: globalThis.fetch });
        const res = await client.messages.create({
          model: llm.model?.trim() || 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        output = Array.isArray(res?.content)
          ? res.content.flatMap(block => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
          : undefined;
      } else if (llm.provider === 'openai' && hasOAuth(llm.oauth)) {
        return await callOpenAIOAuth(config, prompt);
      } else if (llm.provider === 'openai' || llm.provider === 'openai-compatible') {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({
          apiKey: llm.api_key?.trim() || 'none',
          ...(llm.base_url ? { baseURL: llm.base_url.trim().replace(/\/+$/, '') } : {}),
          timeout: 30000,
          maxRetries: 0,
          fetch: globalThis.fetch,
        });
        const res = await client.chat.completions.create({
          model: llm.model?.trim() || 'gpt-4o-mini',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        output = res?.choices?.[0]?.message?.content;
      } else {
        const baseUrl = (llm.base_url?.trim() || 'http://localhost:11434').replace(/\/+$/, '');
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: llm.model!.trim(), prompt, stream: false }),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw Object.assign(new Error('LLM request failed'), { status: res.status });
        const data = await res.json() as { response?: unknown } | null;
        output = data?.response;
      }
      if (typeof output !== 'string' || !output.trim()) throw new Error('LLM returned no text');
      return output.trim();
    } catch (error) {
      const err = error as { status?: number; name?: string };
      const status = err?.status;
      const network = error instanceof TypeError || ['APIConnectionError', 'APIConnectionTimeoutError', 'AbortError', 'TimeoutError'].some(name => name === err?.name || (error instanceof Error && name === error.constructor.name));
      const transient = network || status === 429 || (status !== undefined && status >= 500);
      if (transient && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 1000));
        continue;
      }
      const reason = status === 401 || status === 403 ? 'login failed'
        : status ? `request failed (HTTP ${status})`
        : network ? 'connection failed or timed out'
        : 'returned unusable output';
      throw new Error(`LLM ${reason}. Check the provider and model. Run layman --brain.`);
    }
  }
  throw new Error('LLM connection failed. Run layman --brain.');
}

export async function checkLLMConnection(config: LaymanConfig): Promise<void> {
  const reply = await callLLM(config, 'Reply with exactly pong. No other text.', 20);
  if (reply.toLowerCase() !== 'pong') {
    throw new Error('LLM did not reply with pong. Check the model. Run layman --brain.');
  }
}
