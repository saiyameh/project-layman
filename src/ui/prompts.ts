import * as p from '@clack/prompts';
import chalk from 'chalk';
import type { GitHubRepo } from '../describers/index.js';

function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel(chalk.yellow('UGH. CAVE PERSON LEAVE. BYE.'));
    process.exit(0);
  }
}

export async function askDomain(): Promise<string> {
  const domain = await p.text({
    message: 'What domain or idea are you exploring?',
    placeholder: 'e.g. rust web servers, ML image classification',
    validate: (v) => {
      if (!v || !v.trim()) return 'Must not be empty';
    },
  });
  handleCancel(domain);
  return (domain as string).trim();
}

export async function askResultCount(defaultCount: number = 10): Promise<number> {
  const count = await p.text({
    message: `How many results? (default: ${defaultCount})`,
    defaultValue: String(defaultCount),
    validate: (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 50) return 'Must be a number between 1 and 50';
    },
  });
  handleCancel(count);
  return parseInt(count as string, 10);
}

export async function askRepoSelection(repos: GitHubRepo[]): Promise<GitHubRepo[]> {
  const options = repos.map(repo => ({
    value: repo,
    label: repo.full_name,
    hint: repo.caveman_description ? repo.caveman_description.substring(0, 60) : undefined,
  }));

  const selected = await p.multiselect({
    message: 'Select repos (space = select, enter = confirm)',
    options,
    required: true,
  });
  handleCancel(selected);
  return selected as GitHubRepo[];
}

export type RepoAction = 'fork_clone' | 'star' | 'fork_clone_star' | 'readme';

export async function askRepoAction(): Promise<RepoAction> {
  const action = await p.select({
    message: 'What would you like to do with selected repos?',
    options: [
      { value: 'fork_clone', label: 'Fork & Clone', hint: 'fork to your account and clone locally' },
      { value: 'star', label: 'Star only', hint: 'add a star without forking' },
      { value: 'fork_clone_star', label: 'Fork, Clone & Star', hint: 'do everything' },
      { value: 'readme', label: 'View README', hint: 'peek at a repo\'s README first' },
    ],
  });
  handleCancel(action);
  return action as RepoAction;
}

export async function askReadmeRepo(repos: GitHubRepo[]): Promise<GitHubRepo> {
  const options = repos.map(repo => ({
    value: repo,
    label: repo.full_name,
  }));

  const selected = await p.select({
    message: 'Which repo\'s README do you want to view?',
    options,
  });
  handleCancel(selected);
  return selected as GitHubRepo;
}

export async function askEditor(detectedEditors: string[], savedEditor?: string): Promise<string> {
  if (savedEditor) {
    const useIt = detectedEditors.includes(savedEditor);
    if (useIt) return savedEditor;
  }

  const options = detectedEditors.map(e => ({ value: e, label: e }));
  options.push({ value: '__custom', label: 'Other (enter command)' });

  const choice = await p.select({
    message: 'Open workspace in which editor?',
    options,
  });
  handleCancel(choice);

  if (choice === '__custom') {
    const cmd = await p.text({
      message: 'Enter editor command',
      validate: (v) => { if (!v) return 'Required'; },
    });
    handleCancel(cmd);
    return cmd as string;
  }

  return choice as string;
}

export async function askSearchAgain(): Promise<boolean> {
  const again = await p.confirm({
    message: 'UGH. SEARCH MORE THINGS?',
  });
  handleCancel(again);
  return again as boolean;
}

export async function askOverwriteRepo(repoName: string): Promise<'overwrite' | 'skip' | 'pull'> {
  const choice = await p.select({
    message: `${repoName} already exists in your cave. What do?`,
    options: [
      { value: 'pull', label: 'Update (git pull)', hint: 'keep existing and pull latest' },
      { value: 'overwrite', label: 'Overwrite', hint: 'delete and re-clone' },
      { value: 'skip', label: 'Skip', hint: 'leave it alone' },
    ],
  });
  handleCancel(choice);
  return choice as 'overwrite' | 'skip' | 'pull';
}

export async function confirmProceed(message: string): Promise<boolean> {
  const result = await p.confirm({ message });
  handleCancel(result);
  return result as boolean;
}
