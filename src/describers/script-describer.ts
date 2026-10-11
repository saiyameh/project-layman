import type { GitHubRepo, DescriptionProvider } from './index.js';

export class ScriptDescriber implements DescriptionProvider {
  async describe(repo: GitHubRepo): Promise<string> {
    const description = repo.description?.trim();
    return description || 'No description provided.';
  }
}
