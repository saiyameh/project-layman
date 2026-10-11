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
  runLLMSetup,
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
  askStartAction,
  askContributionPath,
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
  brain: boolean;
  contribute: boolean;
  contributePath: string | null;
  undo: boolean;
  operation: 'prepare' | 'resume' | 'check' | 'submit' | 'status' | 'cleanup';
  issue: string | undefined;
  fresh: boolean;
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
    brain: false,
    contribute: false,
    contributePath: null,
    undo: false,
    operation: 'prepare',
    issue: undefined,
    fresh: false,
  };

  const operations = args.filter(arg => ['--resume', '--check', '--submit', '--status', '--cleanup'].includes(arg));
  if (operations.length > 1) throw new Error('Choose one contribution operation.');
  for (let i = 0; i < args.length; i++) {
    const value = () => {
      const next = args[++i];
      if (!next || next.startsWith('-')) throw new Error(`${args[i - 1]} needs a value.`);
      return next;
    };
    const arg = args[i];
    switch (arg) {
      case '--reset': flags.reset = true; break;
      case '--help': case '-h': flags.help = true; break;
      case '--version': case '-v': flags.version = true; break;
      case '--json': flags.json = true; break;
      case '--history': flags.history = true; break;
      case '--doctor': flags.doctor = true; break;
      case '--brain': flags.brain = true; break;
      case '--undo': flags.undo = true; break;
      case '--new': flags.fresh = true; flags.contribute = true; break;
      case '--resume': case '--check': case '--submit': case '--status': case '--cleanup':
        flags.operation = arg.slice(2) as CLIFlags['operation'];
        flags.contribute = true;
        break;
      case '--issue':
        flags.issue = value();
        flags.contribute = true;
        if (!flags.issue || flags.issue.startsWith('--')) throw new Error('--issue needs a number or GitHub issue URL.');
        break;
      case '--contribute':
        flags.contribute = true;
        if (args[i + 1] && !args[i + 1].startsWith('--')) {
          flags.contributePath = args[++i];
        }
        break;
      case '--mode':
        flags.mode = value() as 'script' | 'llm';
        break;
      case '--count': case '-c':
        { const count = value(); flags.count = /^\d+$/.test(count) ? Number(count) : NaN; }
        break;
      case '--query': case '-q':
        flags.query = value();
        break;
      case '--sort': case '-s':
        flags.sort = value() as 'stars' | 'forks' | 'updated';
        break;
      case '--language': case '-l':
        flags.language = value();
        break;
      case '--editor':
        flags.editor = value();
        break;
      default: throw new Error(`Unknown argument: ${arg}. Run --help.`);
    }
  }

  if (flags.mode && !['script', 'llm'].includes(flags.mode)) throw new Error('--mode must be script or llm.');
  if (flags.count !== null && (!Number.isInteger(flags.count) || flags.count < 1 || flags.count > 50)) throw new Error('--count must be an integer from 1 to 50.');
  if (!['stars', 'forks', 'updated'].includes(flags.sort)) throw new Error('--sort must be stars, forks, or updated.');
  if (flags.issue && (flags.undo || ['status', 'cleanup'].includes(flags.operation))) throw new Error('--issue requires preparation, resume, check, or submission.');
  if (flags.undo && flags.operation !== 'prepare') throw new Error('Use --undo by itself or with --contribute <folder>.');
  if (flags.fresh && flags.operation !== 'prepare') throw new Error('--new starts preparation. Use it with --contribute.');
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
${chalk.bold.yellow('Layman')} -- Find GitHub projects and prepare contributions

${chalk.bold('Diagnostics:')}
  layman --doctor              Check if setup is healthy

${chalk.bold('Usage:')}
  layman                       Interactive mode
  layman --query "react hooks" Search directly
  layman --history             View past searches
  layman --contribute [path]   Guide a contribution from this folder

${chalk.bold('Flags:')}
  ${chalk.cyan('--query, -q')}    <text>     Search query (skip prompt)
  ${chalk.cyan('--count, -c')}    <number>   Number of results (1-50)
  ${chalk.cyan('--sort, -s')}     <field>    Sort by: stars, forks, updated
  ${chalk.cyan('--language, -l')} <lang>     Filter by language
  ${chalk.cyan('--mode')}         <mode>     Description mode: script, llm
  ${chalk.cyan('--editor')}       <cmd>      Editor command override
  ${chalk.cyan('--json')}                    Output results as JSON
  ${chalk.cyan('--history')}                 View search history
  ${chalk.cyan('--doctor')}                  Run setup diagnostics
  ${chalk.cyan('--brain')}                   Connect a model; keep other settings
  ${chalk.cyan('--contribute')}   [path]     Start contribution guide (default: current folder)
  ${chalk.cyan('--undo')}                    Undo verified owned resources (optional --contribute path)
  ${chalk.cyan('--resume')}                  Continue saved work
  ${chalk.cyan('--check')}                   Run trusted project checks
  ${chalk.cyan('--submit')}                  Review, then publish the contribution
  ${chalk.cyan('--status')}                  Show PR, CI, and review status
  ${chalk.cyan('--cleanup')}                 Clean resources Layman owns after merge or closure
  ${chalk.cyan('--issue')}        <ref>      Link a verified issue number or URL
  ${chalk.cyan('--new')}                     Prepare another contribution
  ${chalk.cyan('--reset')}                   Reset configuration
  ${chalk.cyan('--help, -h')}               Show this help
  ${chalk.cyan('--version, -v')}            Show version

${chalk.bold('Git words:')}
  branch  Separate work area
  fork    Copy of a repository in your GitHub account
  clone   Local copy of a repository
  commit  Saved change
  PR      Request for review before merge
  CI      Automatic checks that run for a PR
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
        printWarning(`Version ${data.version} is available. Run: npm update -g project-layman`);
      }
    }
  } catch {
    // silently ignore
  }
}

async function main(): Promise<void> {
  // Interactive discovery has no durable contribution actions.
  const gracefulExit = () => {
    console.log('');
    p.cancel(chalk.yellow('Stopped.'));
    process.exit(0);
  };
  const args = process.argv.slice(2);
  const flags = parseFlags(args);
  const bareInvocation = args.length === 0;
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

  if (bareInvocation && !process.stdin.isTTY) {
    throw new Error('Use layman --contribute <folder-or-GitHub-URL> when input is not interactive.');
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
      printError('No internet connection. Connect to the internet and try again.');
      process.exit(1);
    }
    await runSetupWizard();
    if (flags.brain) return;
  }

  const config = loadConfig();

  if (flags.brain) {
    await runLLMSetup(config);
    return;
  }

  if (flags.mode) {
    config.description_mode = flags.mode;
  }

  if (flags.contribute || flags.undo) {
    const { runContributeFlow } = await import('./contribute/index.js');
    await runContributeFlow(config, flags.contributePath, flags.undo, { operation: flags.operation, issue: flags.issue, fresh: flags.fresh });
    return;
  }

  if (bareInvocation) {
    const action = await askStartAction();
    if (action !== 'find') {
      const rawPath = await askContributionPath(action === 'resume');
      const { runContributeFlow } = await import('./contribute/index.js');
      await runContributeFlow(config, rawPath, false, { operation: action === 'resume' ? 'resume' : 'prepare' });
      return;
    }
  }

  process.on('SIGINT', gracefulExit);
  process.on('SIGTERM', gracefulExit);

  // Background update check (non-blocking)
  checkForUpdates(version);

  // Connectivity check
  const online = await checkConnectivity();
  if (!online) {
    printError('No internet connection. Connect to the internet and try again.');
    process.exit(1);
  }

  // Cache authenticated user early
  try {
    await getAuthenticatedUser(config.github_token);
  } catch {
    printError('GitHub token was rejected. Run layman --reset to update it.');
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
    const cacheKey = `plain-v1|${domain}|${flags.sort}|${flags.language || ''}|${count}`;
    const cached = loadCache(cacheKey);
    let repos: GitHubRepo[];

    if (cached) {
      repos = cached as GitHubRepo[];
      if (!flags.json) {
        printInfo('Using cached results (less than 10 min old)');
      }
    } else {
      const s = p.spinner();
      if (!flags.json) s.start('Searching GitHub...');

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
        printError('No repositories found. Try different search words.');
        if (flags.query) process.exit(0);
        keepSearching = await askSearchAgain();
        continue;
      }

      // Generate descriptions
      const describer = createDescriber(config);
      const s2 = p.spinner();
      if (!flags.json) s2.start('Writing repository summaries...');

      for (let i = 0; i < repos.length; i++) {
        if (!flags.json) s2.message(`Writing repository summaries... (${i + 1}/${repos.length})`);
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
        s3.start('Reading README...');
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
          s4.start(`Creating your fork of ${repo.name}...`);

          try {
            await forkRepo(config.github_token, repo.owner, repo.name);
            s4.stop(`Forked ${repo.name}`);
          } catch (err) {
            s4.stop('Fork failed');
            printError((err as Error).message);
            continue;
          }

          const s5 = p.spinner();
          s5.start(`Cloning ${repo.name} to your computer...`);

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
              printSuccess(`${repo.name} is ready in ${clonedPath}.`);
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
            printSuccess('Project opened in your editor.');
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

  p.outro(chalk.bold.yellow('Done.'));
}

main().catch(err => {
  printError(`Layman stopped: ${err.message}`);
  process.exit(1);
});
