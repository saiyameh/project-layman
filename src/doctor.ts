import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { configExists, loadConfig, validateToken, checkConnectivity, type LaymanConfig } from './config.js';
import { detectInstalledEditors, getEditorDisplayName } from './workspace.js';
import { ScriptDescriber } from './describers/script-describer.js';
import { checkLLMConnection, getLLMConfigError } from './contribute/llm.js';

async function checkLLMApiCall(config: LaymanConfig): Promise<CheckResult> {
  const start = Date.now();
  try {
    await checkLLMConnection(config);
    return { label: 'LLM API call', ok: true, detail: `Connected (${Date.now() - start}ms)` };
  } catch (err) {
    return { label: 'LLM API call', ok: false, detail: (err as Error).message };
  }
}

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
}

function checkCommand(cmd: string): boolean {
  const { status } = spawnSync('which', [cmd], { stdio: 'pipe' });
  return status === 0;
}

function getCommandVersion(cmd: string): string {
  try {
    const { stdout } = spawnSync(cmd, ['--version'], { stdio: 'pipe' });
    return stdout?.toString().trim().split('\n')[0] || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function runDoctor(): Promise<void> {
  console.log(chalk.bold.yellow('\n  Layman Doctor\n'));
  console.log(chalk.dim('  Checking setup...\n'));

  const results: CheckResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  results.push({
    label: 'Node.js',
    ok: nodeMajor >= 18,
    detail: nodeMajor >= 18
      ? `${nodeVersion} (v18+ required)`
      : `${nodeVersion}. Install Node.js v18 or later.`,
  });

  // 2. Git
  const hasGit = checkCommand('git');
  results.push({
    label: 'Git',
    ok: hasGit,
    detail: hasGit ? getCommandVersion('git') : 'Not found. Install Git.',
  });

  // 3. Internet connectivity
  const online = await checkConnectivity();
  results.push({
    label: 'Internet',
    ok: online,
    detail: online ? 'GitHub API reachable' : 'Cannot reach GitHub API',
  });

  // 4. Config file
  const hasConfig = configExists();
  results.push({
    label: 'Config file',
    ok: hasConfig,
    detail: hasConfig
      ? path.join(os.homedir(), '.layman', 'config.json')
      : 'Not found. Run layman to set up.',
  });

  // 5. Config file permissions
  if (hasConfig) {
    const configPath = path.join(os.homedir(), '.layman', 'config.json');
    try {
      const stats = fs.statSync(configPath);
      const mode = (stats.mode & 0o777).toString(8);
      const isSecure = mode === '600';
      results.push({
        label: 'Config permissions',
        ok: isSecure,
        detail: isSecure ? '600 (secure)' : `${mode}. Use 600. Run layman --reset.`,
      });
    } catch {
      results.push({ label: 'Config permissions', ok: false, detail: 'Could not read file stats' });
    }
  }

  // 6. GitHub token
  if (hasConfig) {
    const config = loadConfig();
    const tokenSet = !!config.github_token;
    results.push({
      label: 'GitHub token',
      ok: tokenSet,
      detail: tokenSet ? 'Set (hidden)' : 'Not set. Run layman --reset.',
    });

    // 7. Token validation
    if (tokenSet && online) {
      const username = await validateToken(config.github_token);
      results.push({
        label: 'Token valid',
        ok: !!username,
        detail: username ? `Authenticated as ${username}` : 'Token rejected by GitHub',
      });
    }

    // 8. Description mode
    results.push({
      label: 'Description mode',
      ok: true,
      detail: config.description_mode === 'llm'
        ? `LLM (${config.llm.provider || 'none'})`
        : 'Script (offline)',
    });

    // 10. Editor
    const editorInstalled = checkCommand(config.editor_command);
    results.push({
      label: 'Editor',
      ok: editorInstalled,
      detail: editorInstalled
        ? `${getEditorDisplayName(config.editor_command)} (${config.editor_command})`
        : `"${config.editor_command}" not found in PATH`,
    });

    // 11. Workspace directory
    const wsDir = config.workspace_dir.replace(/^~/, os.homedir());
    const wsExists = fs.existsSync(wsDir);
    results.push({
      label: 'Workspace dir',
      ok: true,
      detail: wsExists ? `${wsDir} (exists)` : `${wsDir}. Created on first clone.`,
    });

    // 12. Clone protocol
    if (config.clone_protocol === 'ssh') {
      const sshDir = path.join(os.homedir(), '.ssh');
      const hasKeys = fs.existsSync(sshDir) &&
        fs.readdirSync(sshDir).some(f => f.startsWith('id_') && !f.endsWith('.pub'));
      results.push({
        label: 'SSH keys',
        ok: hasKeys,
        detail: hasKeys ? 'Found in ~/.ssh' : 'No SSH keys found. Clone may fail.',
      });
    }
    results.push({
      label: 'Clone protocol',
      ok: true,
      detail: config.clone_protocol.toUpperCase(),
    });
  }

  // 13. Detected editors
  const editors = detectInstalledEditors();
  results.push({
    label: 'Editors in PATH',
    ok: editors.length > 0,
    detail: editors.length > 0
      ? editors.map(e => getEditorDisplayName(e)).join(', ')
      : 'None found',
  });

  // 14. Script describer sanity check
  try {
    const describer = new ScriptDescriber();
    const testResult = await describer.describe({
      rank: 1, name: 'test', full_name: 'test/test', owner: 'test',
      description: 'A fast web framework', stars: 10, forks: 1,
      language: 'TypeScript', url: '', topics: [],
    });
    const works = testResult.trim().length > 0;
    results.push({
      label: 'Script describer',
      ok: works,
      detail: works ? 'Pipeline working' : 'Output unexpected',
    });
  } catch {
    results.push({ label: 'Script describer', ok: false, detail: 'Pipeline error' });
  }

  // 15-17. Contribute mode checks
  console.log(chalk.dim('\n  Contribution setup\n'));

  if (hasConfig) {
    const config = loadConfig();
    const { llm } = config;
    const llmError = getLLMConfigError(llm);
    const llmReady = llmError === null;
    results.push({
      label: 'LLM for contribute',
      ok: llmReady,
      detail: llmReady
        ? `${llm.provider} configured`
        : llmError!,
    });

    if (llmReady) {
      process.stdout.write(chalk.dim('  Probing LLM API...'));
      const apiResult = await checkLLMApiCall(config);
      process.stdout.write('\r' + ' '.repeat(30) + '\r');
      results.push(apiResult);
    } else {
      results.push({ label: 'LLM API call', ok: false, detail: 'Skipped. AI provider is not configured.' });
    }
  } else {
    results.push({ label: 'LLM for contribute', ok: false, detail: 'No configuration. Run layman first.' });
    results.push({ label: 'LLM API call', ok: false, detail: 'Skipped. No configuration.' });
  }

  results.push({ label: 'File guidance', ok: true, detail: 'Static source scan; no project tools or downloads' });

  // Print results
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  for (const r of results) {
    const icon = r.ok ? chalk.green('[OK]') : chalk.red('[!!]');
    const label = chalk.bold(r.label.padEnd(20));
    const detail = r.ok ? chalk.dim(r.detail) : chalk.red(r.detail);
    console.log(`  ${icon} ${label} ${detail}`);
  }

  console.log('');
  console.log(chalk.dim(`  ${passed} passed, ${failed} failed`));

  if (failed === 0) {
    console.log(chalk.bold.green('\n  Setup is ready.\n'));
  } else {
    console.log(chalk.bold.yellow(`\n  Fix ${failed} item${failed > 1 ? 's' : ''}.\n`));
  }
}
