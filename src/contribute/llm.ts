import type { LaymanConfig } from '../config.js';

export async function callLLM(config: LaymanConfig, prompt: string, maxTokens = 600): Promise<string> {
  const { llm } = config;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (llm.provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: llm.api_key! });
        const res = await client.messages.create({
          model: llm.model || 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        const block = res.content[0];
        return block.type === 'text' ? block.text : '';
      }

      if (llm.provider === 'openai' || llm.provider === 'openai-compatible') {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({
          apiKey: llm.api_key ?? 'none',
          ...(llm.base_url ? { baseURL: llm.base_url } : {}),
        });
        const res = await client.chat.completions.create({
          model: llm.model || 'gpt-4o-mini',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        return res.choices[0]?.message?.content || '';
      }

      if (llm.provider === 'ollama') {
        const baseUrl = llm.base_url || 'http://localhost:11434';
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: llm.model, prompt, stream: false }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as { response: string };
        return data.response || '';
      }
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error('LLM call failed after retries');
}
