import * as p from '@clack/prompts';
import chalk from 'chalk';
import type { GitHubRepo } from '../describers/index.js';

function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel(chalk.yellow('Stopped.'));
    process.exit(0);
  }
}

export async function askDomain(): Promise<string> {
  const domain = await p.text({
    message: 'What are you looking for?',
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
    message: `How many results? Default: ${defaultCount}`,
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
    hint: repo.caveman_description || undefined,
  }));

  const selected = await p.multiselect({
    message: 'Select repositories. Space selects. Enter confirms.',
    options,
    required: true,
  });
  handleCancel(selected);
  return selected as GitHubRepo[];
}

export type RepoAction = 'fork_clone' | 'star' | 'fork_clone_star' | 'readme';

export async function askRepoAction(): Promise<RepoAction> {
  const action = await p.select({
    message: 'Choose an action.',
    options: [
      { value: 'fork_clone', label: 'Fork and clone', hint: 'Fork: copy to your GitHub account. Clone: download it here.' },
      { value: 'star', label: 'Star', hint: 'Save this repository to your GitHub starred list.' },
      { value: 'fork_clone_star', label: 'Fork, clone, and star', hint: 'Copy it to your account, download it here, and star it.' },
      { value: 'readme', label: 'Read README', hint: 'Read the project instructions before you act.' },
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
    message: 'Which repository README do you want to read?',
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
    message: 'Which editor should open this workspace?',
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
    message: 'Search again?',
  });
  handleCancel(again);
  return again as boolean;
}

export type StartAction = 'start' | 'resume' | 'find';

export async function askStartAction(): Promise<StartAction> {
  const action = await p.select({
    message: 'What do you want to do?',
    initialValue: 'start',
    options: [
      { value: 'start', label: 'Start contribution', hint: 'Prepare a new change for review.' },
      { value: 'resume', label: 'Resume work', hint: 'Continue saved contribution work.' },
      { value: 'find', label: 'Find a project', hint: 'Search GitHub projects.' },
    ],
  });
  handleCancel(action);
  return action as StartAction;
}

export async function askContributionPath(resume: boolean): Promise<string> {
  const location = await p.text({
    message: resume ? 'Enter the existing local repository folder.' : 'Enter a repository folder or GitHub URL.',
    placeholder: resume ? '/path/to/repository' : 'https://github.com/owner/repository',
    validate: (value) => {
      if (!value.trim()) return 'Enter a repository location.';
      if (resume && /^(?:https?:|git@)/.test(value.trim())) return 'Resume work needs an existing local repository folder.';
    },
  });
  handleCancel(location);
  return (location as string).trim();
}

export async function askOverwriteRepo(repoName: string): Promise<'overwrite' | 'skip' | 'pull'> {
  const choice = await p.select({
    message: `${repoName} already exists. Choose an action.`,
    options: [
      { value: 'pull', label: 'Update (`git pull`)', hint: 'Keep this folder and download its latest changes.' },
      { value: 'overwrite', label: 'Overwrite', hint: 'Delete this folder, then clone the repository again.' },
      { value: 'skip', label: 'Skip', hint: 'Leave this folder unchanged.' },
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
