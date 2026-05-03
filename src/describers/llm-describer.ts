import type { GitHubRepo, DescriptionProvider } from './index.js';
import type { LaymanConfig } from '../config.js';
import { ScriptDescriber } from './script-describer.js';
import pLimit from 'p-limit';

const SYSTEM_PROMPT = `You are a caveman who has somehow learned to describe software projects.
Speak ONLY in caveman style: short sentences, broken grammar, no articles,
uppercase for emphasis. Drop "a", "an", "the". Use "UGH", "SMASH", "FIRE",
"MAMMOTH", "CAVE" as metaphors for computing concepts.
Keep description under 100 characters. Be accurate but sound prehistoric.
Start every description with "UGH."`;

function buildUserPrompt(repo: GitHubRepo): string {
  const desc = repo.description ? repo.description.substring(0, 300) : 'No description available';
  return `Describe this GitHub project in caveman style:
Name: ${repo.name}
Description: ${desc}
Language: ${repo.language || 'Unknown'}
Topics: ${repo.topics.join(', ') || 'none'}`;
}

async function callAnthropic(config: LaymanConfig, prompt: string): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.llm.api_key! });
  const response = await client.messages.create({
    model: config.llm.model || 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

async function callOpenAI(config: LaymanConfig, prompt: string): Promise<string> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: config.llm.api_key! });
  const response = await client.chat.completions.create({
    model: config.llm.model || 'gpt-4o-mini',
    max_tokens: 100,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });
  return response.choices[0]?.message?.content || '';
}

async function callOllama(config: LaymanConfig, prompt: string): Promise<string> {
  const baseUrl = config.llm.base_url || 'http://localhost:11434';
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.llm.model,
      prompt: `${SYSTEM_PROMPT}\n\n${prompt}`,
      stream: false,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json() as { response: string };
  return data.response || '';
}

async function callLLMWithRetry(config: LaymanConfig, prompt: string, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      switch (config.llm.provider) {
        case 'anthropic': return await callAnthropic(config, prompt);
        case 'openai': return await callOpenAI(config, prompt);
        case 'ollama': return await callOllama(config, prompt);
        default: throw new Error('Unknown LLM provider');
      }
    } catch {
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error('LLM call failed after retries');
}

export class LLMDescriber implements DescriptionProvider {
  private config: LaymanConfig;
  private fallback: ScriptDescriber;
  private limit: ReturnType<typeof pLimit>;

  constructor(config: LaymanConfig) {
    this.config = config;
    this.fallback = new ScriptDescriber();
    this.limit = pLimit(3);
  }

  async describe(repo: GitHubRepo): Promise<string> {
    return this.limit(async () => {
      try {
        const prompt = buildUserPrompt(repo);
        const result = await callLLMWithRetry(this.config, prompt);
        return result.trim() || await this.fallback.describe(repo);
      } catch {
        return this.fallback.describe(repo);
      }
    });
  }
}
