export interface GitHubRepo {
  rank: number;
  name: string;
  full_name: string;
  owner: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  url: string;
  topics: string[];
  caveman_description?: string;
}

export interface DescriptionProvider {
  describe(repo: GitHubRepo): Promise<string>;
}

import type { LaymanConfig } from '../config.js';
import { ScriptDescriber } from './script-describer.js';
import { LLMDescriber } from './llm-describer.js';

export function createDescriber(config: LaymanConfig): DescriptionProvider {
  if (config.description_mode === 'llm') {
    return new LLMDescriber(config);
  }
  return new ScriptDescriber();
}
