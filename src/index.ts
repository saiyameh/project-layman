#!/usr/bin/env node

import * as p from '@clack/prompts';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  configExists,
  loadConfig,
  runSetupWizard,
  resetConfig,
  checkConnectivity,
  saveToHistory,
  loadHistory,
  loadCache,
  saveCache,
} from './config.js';

import { createDescriber } from './describers/index.js';
import type { GitHubRepo } from './describers/index.js';
import {
  searchRepos,
  forkRepo,
  starRepo,
  cloneRepo,
  getAuthenticatedUser,
  fetchReadme,
} from './github.js';

import {
  printBanner,
  printRepoTable,
  printRepoTableJSON,
  printSuccess,
  printError,
  printInfo,
  printWarning,
} from './ui/display.js';

import {
  askDomain,
  askResultCount,
  askRepoSelection,
  askRepoAction,
  askReadmeRepo,
  askEditor,
  askSearchAgain,
} from './ui/prompts.js';

import { detectInstalledEditors, openInEditor } from './workspace.js';
import { runDoctor } from './doctor.js';

interface CLIFlags {
  reset: boolean;
  help: boolean;
  version: boolean;
  mode: 'script' | 'llm' | null;
  count: number | null;
  query: string | null;
  sort: 'stars' | 'forks' | 'updated';
  language: string | null;
  editor: string | null;
  json: boolean;
  history: boolean;
  doctor: boolean;
}

function parseFlags(args: string[]): CLIFlags {
  const flags: CLIFlags = {
    reset: false,
    help: false,
    version: false,
    mode: null,
    count: null,
    query: null,
    sort: 'stars',
    language: null,
    editor: null,
    json: false,
    history: false,
    doctor: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--reset': flags.reset = true; break;
      case '--help': case '-h': flags.help = true; break;
      case '--version': case '-v': flags.version = true; break;
      case '--json': flags.json = true; break;
      case '--history': flags.history = true; break;
      case '--doctor': flags.doctor = true; break;
      case '--mode':
        flags.mode = args[++i] as 'script' | 'llm';
        break;
      case '--count': case '-c':
        flags.count = parseInt(args[++i], 10);
        break;
      case '--query': case '-q':
        flags.query = args[++i];
        break;
      case '--sort': case '-s':
        flags.sort = args[++i] as 'stars' | 'forks' | 'updated';
        break;
      case '--language': case '-l':
        flags.language = args[++i];
        break;
      case '--editor':
        flags.editor = args[++i];
        break;
    }
  }

  return flags;
}

function getVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function printHelp(): void {
  console.log(`
${chalk.bold.yellow('PROJECT LAYMAN')} -- Search GitHub like a caveman

${chalk.bold('DIAGNOSTICS:')}
  layman --doctor              Check if setup is healthy

${chalk.bold('USAGE:')}
  layman                       Interactive mode
  layman --query "react hooks" Search directly
  layman --history             View past searches

${chalk.bold('FLAGS:')}
  ${chalk.cyan('--query, -q')}    <text>     Search query (skip prompt)
  ${chalk.cyan('--count, -c')}    <number>   Number of results (1-50)
  ${chalk.cyan('--sort, -s')}     <field>    Sort by: stars, forks, updated
  ${chalk.cyan('--language, -l')} <lang>     Filter by language
  ${chalk.cyan('--mode')}         <mode>     Description mode: script, llm
  ${chalk.cyan('--editor')}       <cmd>      Editor command override
  ${chalk.cyan('--json')}                    Output results as JSON
  ${chalk.cyan('--history')}                 View search history
  ${chalk.cyan('--doctor')}                  Run setup diagnostics
  ${chalk.cyan('--reset')}                   Reset configuration
  ${chalk.cyan('--help, -h')}               Show this help
  ${chalk.cyan('--version, -v')}            Show version
`);
}

async function checkForUpdates(currentVersion: string): Promise<void> {
  try {
    const res = await fetch('https://registry.npmjs.org/project-layman/latest', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json() as { version: string };
      if (data.version && data.version !== currentVersion) {
        printWarning(`UGH. NEW VERSION ${data.version} EXIST. RUN: npm update -g project-layman`);
      }
    }
  } catch {
    // silently ignore
  }
}

async function main(): Promise<void> {
  // Global exit handlers — Ctrl+C works cleanly at any point
  const gracefulExit = () => {
    console.log('');
    p.cancel(chalk.yellow('UGH. I LEAVE. BYE.'));
    process.exit(0);
  };
  process.on('SIGINT', gracefulExit);
  process.on('SIGTERM', gracefulExit);

  const flags = parseFlags(process.argv.slice(2));
  const version = getVersion();

  if (flags.version) {
    console.log(`project-layman v${version}`);
    process.exit(0);
  }

  if (flags.help) {
    printBanner();
    printHelp();
    process.exit(0);
  }

  if (!flags.json) {
    printBanner();
  }

  if (flags.reset) {
    resetConfig();
    printSuccess('Config reset. Running setup wizard...');
    await runSetupWizard();
    process.exit(0);
  }

  if (flags.history) {
    const history = loadHistory();
    if (history.length === 0) {
      printInfo('No search history yet.');
    } else {
      console.log(chalk.bold.yellow('\n  Search History:\n'));
      history.forEach((q, i) => {
        console.log(chalk.cyan(`  ${i + 1}. ${q}`));
      });
      console.log();
    }
    process.exit(0);
  }

  if (flags.doctor) {
    await runDoctor();
    process.exit(0);
  }

  if (!configExists()) {
    const online = await checkConnectivity();
    if (!online) {
      printError('UGH. NO INTERNET. CAVE PERSON NEED WIFI.');
      process.exit(1);
    }
    await runSetupWizard();
  }

  const config = loadConfig();

  if (flags.mode) {
    config.description_mode = flags.mode;
  }

  // Background update check (non-blocking)
  checkForUpdates(version);

  // Connectivity check
  const online = await checkConnectivity();
  if (!online) {
    printError('UGH. NO INTERNET. CAVE PERSON NEED WIFI.');
    process.exit(1);
  }

  // Cache authenticated user early
  try {
    await getAuthenticatedUser(config.github_token);
  } catch {
    printError('UGH. GITHUB TOKEN NO WORK. RUN layman --reset TO FIX.');
    process.exit(1);
  }

  let keepSearching = true;

  while (keepSearching) {
    // Get search query
    const domain = flags.query || await askDomain();

    // Get count
    const count = flags.count || await askResultCount(config.default_result_count);

    // Save to history
    saveToHistory(domain);

    // Check cache
    const cacheKey = `${domain}|${flags.sort}|${flags.language || ''}|${count}`;
    const cached = loadCache(cacheKey);
    let repos: GitHubRepo[];

    if (cached) {
      repos = cached as GitHubRepo[];
      if (!flags.json) {
        printInfo('Using cached results (less than 10 min old)');
      }
    } else {
      const s = p.spinner();
      if (!flags.json) s.start('UGH. SEARCHING CAVE WALLS...');

      try {
        repos = await searchRepos(config.github_token, domain, count, flags.sort, flags.language || undefined);
      } catch (err) {
        if (!flags.json) s.stop('Search failed');
        printError((err as Error).message);
        if (flags.query) process.exit(1);
        keepSearching = !flags.query && await askSearchAgain();
        continue;
      }

      if (!flags.json) s.stop(`Found ${repos.length} repos`);

      if (repos.length === 0) {
        printError('UGH. NO REPOS FOUND. TRY DIFFERENT WORDS.');
        if (flags.query) process.exit(0);
        keepSearching = await askSearchAgain();
        continue;
      }

      // Generate descriptions
      const describer = createDescriber(config);
      const s2 = p.spinner();
      if (!flags.json) s2.start('UGH. THINKING HARD...');

      for (let i = 0; i < repos.length; i++) {
        if (!flags.json) s2.message(`UGH. THINKING HARD... (${i + 1}/${repos.length})`);
        repos[i].caveman_description = await describer.describe(repos[i]);
      }

      if (!flags.json) s2.stop('Descriptions ready');

      // Save to cache
      saveCache(cacheKey, repos);
    }

    // Display results
    if (flags.json) {
      printRepoTableJSON(repos);
      process.exit(0);
    }

    printRepoTable(repos);

    // User action loop
    let actionDone = false;
    while (!actionDone) {
      const action = await askRepoAction();

      if (action === 'readme') {
        const repo = await askReadmeRepo(repos);
        const s3 = p.spinner();
        s3.start('UGH. READING CAVE WALL...');
        const readme = await fetchReadme(config.github_token, repo.owner, repo.name);
        s3.stop(`README for ${repo.full_name}`);
        console.log(chalk.dim('─'.repeat(60)));
        console.log(readme);
        console.log(chalk.dim('─'.repeat(60)));
        continue;
      }

      const selected = await askRepoSelection(repos);

      if (action === 'star' || action === 'fork_clone_star') {
        for (const repo of selected) {
          try {
            await starRepo(config.github_token, repo.owner, repo.name);
            printSuccess(`Starred ${repo.full_name}`);
          } catch (err) {
            printError((err as Error).message);
          }
        }
      }

      if (action === 'fork_clone' || action === 'fork_clone_star') {
        const clonedPaths: string[] = [];

        for (const repo of selected) {
          const s4 = p.spinner();
          s4.start(`UGH. COPYING ${repo.name} INTO YOUR CAVE...`);

          try {
            await forkRepo(config.github_token, repo.owner, repo.name);
            s4.stop(`Forked ${repo.name}`);
          } catch (err) {
            s4.stop('Fork failed');
            printError((err as Error).message);
            continue;
          }

          const s5 = p.spinner();
          s5.start(`UGH. DRAGGING ${repo.name} TO YOUR CAVE...`);

          try {
            const clonedPath = await cloneRepo(
              config.github_token,
              repo.name,
              repo.owner,
              config.workspace_dir,
              config.clone_protocol,
            );
            s5.stop(`Cloned ${repo.name}`);
            if (clonedPath) {
              clonedPaths.push(clonedPath);
              printSuccess(`${repo.name} NOW IN YOUR CAVE. GOOD.`);
            }
          } catch (err) {
            s5.stop('Clone failed');
            printError((err as Error).message);
          }
        }

        if (clonedPaths.length > 0) {
          const detectedEditors = detectInstalledEditors();
          const editorCommand = flags.editor || await askEditor(detectedEditors, config.editor_command);

          try {
            await openInEditor(clonedPaths, editorCommand);
            printSuccess('CAVE PERSON READY TO BUILD. UGH.');
          } catch (err) {
            printError((err as Error).message);
          }
        }
      }

      actionDone = true;
    }

    if (flags.query) {
      keepSearching = false;
    } else {
      keepSearching = await askSearchAgain();
    }
  }

  p.outro(chalk.bold.yellow('UGH. BYE BYE. COME BACK TO CAVE SOON.'));
}

main().catch(err => {
  printError(`UGH. SOMETHING BROKE: ${err.message}`);
  process.exit(1);
});
