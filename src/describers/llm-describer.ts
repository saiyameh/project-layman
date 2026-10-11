import type { GitHubRepo, DescriptionProvider } from './index.js';
import type { LaymanConfig } from '../config.js';
import { ScriptDescriber } from './script-describer.js';
import pLimit from 'p-limit';
import { callLLM } from '../contribute/llm.js';
import { CLI_EXPLANATION_RULES } from '../ui/caveman.js';

const SYSTEM_PROMPT = `${CLI_EXPLANATION_RULES}

Describe the GitHub project in one or two short sentences. Explain technical terms when useful. Do not add facts.`;

function buildUserPrompt(repo: GitHubRepo): string {
  const desc = repo.description || 'No description available';
  return `Describe this GitHub project:
Name: ${repo.name}
Description: ${desc}
Language: ${repo.language || 'Unknown'}
Topics: ${repo.topics.join(', ') || 'none'}`;
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
        const result = await callLLM(this.config, `${SYSTEM_PROMPT}\n\n${prompt}`, 100);
        return result.trim() || await this.fallback.describe(repo);
      } catch {
        return this.fallback.describe(repo);
      }
    });
  }
}
