import chalk from 'chalk';
import Table from 'cli-table3';
import type { GitHubRepo } from '../describers/index.js';

export function printBanner(): void {
  const caveman = chalk.bold.yellow(`
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠛⠲⠦⠤⣄⣀⠀⢀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣀⠀⠀⠀⠀⠀⠘⠿⠟⠀⢤⠀⣠⣤⣄⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⡆⠀⠀⠀⠀⢰⡖⠀⠀⠀⠀⠙⠿⠿⠓⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⣿⠃⠀⠀⠀⠀⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢀⣠⣤⣤⣤⣄⡉⠁⣠⡄⢀⣀⣼⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⣰⣿⣿⠟⣿⣿⡿⠁⣴⣿⠁⡸⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢰⡿⠋⠀⢰⠿⠋⡀⢈⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⣿⡇⠀⠀⠠⠴⣾⣿⣿⣯⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠉⠁⠀⠀⢀⣀⣼⣿⡿⠿⠿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠈⠛⣿⠿⣄⠀⢠⣾⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢀⣿⠀⠁⠀⠁⠀⠀⠉⢿⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⢀⣤⣤⣤⣤⣾⡿⠃⠀⠀⠀⠀⠀⠀⠘⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
`);
  console.log(caveman + chalk.bold.white('          PROJECT LAYMAN UGH.\n'));
}

function formatStars(stars: number): string {
  if (stars >= 1000) return chalk.bold.white(`${(stars / 1000).toFixed(1)}k`);
  return chalk.bold.white(String(stars));
}

function formatForks(forks: number): string {
  if (forks >= 1000) return `${(forks / 1000).toFixed(1)}k`;
  return String(forks);
}

export function printRepoTable(repos: GitHubRepo[]): void {
  const table = new Table({
    head: [
      chalk.bold.yellow('#'),
      chalk.bold.yellow('Name'),
      chalk.bold.yellow('Stars'),
      chalk.bold.yellow('Forks'),
      chalk.bold.yellow('Lang'),
      chalk.bold.yellow('Description'),
    ],
    colWidths: [5, 32, 9, 9, 14, 52],
    wordWrap: true,
    style: { head: [], border: ['dim'] },
  });

  for (const repo of repos) {
    table.push([
      chalk.dim(String(repo.rank)),
      chalk.cyan(repo.full_name),
      formatStars(repo.stars),
      formatForks(repo.forks),
      repo.language ? chalk.green(repo.language) : chalk.dim('??'),
      chalk.white(repo.caveman_description || ''),
    ]);
  }

  console.log(table.toString());
  console.log();
}

export function printRepoTableJSON(repos: GitHubRepo[]): void {
  const output = repos.map(r => ({
    rank: r.rank,
    name: r.full_name,
    stars: r.stars,
    forks: r.forks,
    language: r.language,
    url: r.url,
    description: r.caveman_description,
  }));
  console.log(JSON.stringify(output, null, 2));
}

export function printSuccess(message: string): void {
  console.log(chalk.bold.green(`  [OK] ${message}`));
}

export function printError(message: string): void {
  console.log(chalk.bold.red(`  [ERR] ${message}`));
}

export function printInfo(message: string): void {
  console.log(chalk.cyan(`  [i] ${message}`));
}

export function printWarning(message: string): void {
  console.log(chalk.yellow(`  [!] ${message}`));
}
