import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { configExists, loadConfig, validateToken, checkConnectivity } from './config.js';
import { detectInstalledEditors, getEditorDisplayName } from './workspace.js';
import { ScriptDescriber } from './describers/script-describer.js';

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
  console.log(chalk.dim('  Running diagnostics...\n'));

  const results: CheckResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  results.push({
    label: 'Node.js',
    ok: nodeMajor >= 18,
    detail: nodeMajor >= 18
      ? `${nodeVersion} (v18+ required)`
      : `${nodeVersion} -- UPGRADE TO v18+`,
  });

  // 2. Git
  const hasGit = checkCommand('git');
  results.push({
    label: 'Git',
    ok: hasGit,
    detail: hasGit ? getCommandVersion('git') : 'NOT FOUND -- install git',
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
      : 'Not found -- run layman to set up',
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
        detail: isSecure ? '600 (secure)' : `${mode} -- should be 600, run layman --reset`,
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
      detail: tokenSet
        ? `${config.github_token.substring(0, 8)}...`
        : 'Not set -- run layman --reset',
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

    // 9. LLM provider (if applicable)
    if (config.description_mode === 'llm') {
      const hasKey = config.llm.provider === 'ollama' || !!config.llm.api_key;
      results.push({
        label: 'LLM API key',
        ok: hasKey,
        detail: hasKey
          ? `${config.llm.provider} configured`
          : `No API key for ${config.llm.provider}`,
      });
    }

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
      detail: wsExists ? `${wsDir} (exists)` : `${wsDir} (will be created on first clone)`,
    });

    // 12. Clone protocol
    if (config.clone_protocol === 'ssh') {
      const sshDir = path.join(os.homedir(), '.ssh');
      const hasKeys = fs.existsSync(sshDir) &&
        fs.readdirSync(sshDir).some(f => f.startsWith('id_') && !f.endsWith('.pub'));
      results.push({
        label: 'SSH keys',
        ok: hasKeys,
        detail: hasKeys ? 'Found in ~/.ssh' : 'No SSH keys found -- clone may fail',
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
      : 'None detected',
  });

  // 14. Script describer sanity check
  try {
    const describer = new ScriptDescriber();
    const testResult = await describer.describe({
      rank: 1, name: 'test', full_name: 'test/test', owner: 'test',
      description: 'A fast web framework', stars: 10, forks: 1,
      language: 'TypeScript', url: '', topics: [],
    });
    const works = testResult.startsWith('UGH.');
    results.push({
      label: 'Script describer',
      ok: works,
      detail: works ? 'Pipeline working' : 'Output unexpected',
    });
  } catch {
    results.push({ label: 'Script describer', ok: false, detail: 'Pipeline error' });
  }

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
    console.log(chalk.bold.green('\n  UGH. EVERYTHING GOOD. CAVE READY.\n'));
  } else {
    console.log(chalk.bold.yellow(`\n  UGH. ${failed} THING${failed > 1 ? 'S' : ''} NEED FIX.\n`));
  }
}
