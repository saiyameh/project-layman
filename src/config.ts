import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';
import chalk from 'chalk';

export interface LaymanConfig {
  github_token: string;
  description_mode: 'script' | 'llm';
  llm: {
    provider: 'anthropic' | 'openai' | 'ollama' | null;
    api_key: string | null;
    model: string | null;
    base_url: string | null;
  };
  editor: string;
  editor_command: string;
  workspace_dir: string;
  default_result_count: number;
  clone_protocol: 'https' | 'ssh';
}

interface CacheEntry {
  timestamp: number;
  results: unknown[];
}

interface CacheStore {
  [key: string]: CacheEntry;
}

const CONFIG_DIR = path.join(os.homedir(), '.layman');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const CACHE_FILE = path.join(CONFIG_DIR, 'cache.json');
const CACHE_TTL_MS = 10 * 60 * 1000;

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): LaymanConfig {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return JSON.parse(raw) as LaymanConfig;
}

export function saveConfig(config: LaymanConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  fs.chmodSync(CONFIG_FILE, 0o600);
}

export function resetConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

export function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

export function saveToHistory(query: string): void {
  ensureConfigDir();
  const history = loadHistory().filter(h => h !== query);
  history.unshift(query);
  const trimmed = history.slice(0, 50);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}

export function loadCache(key: string): unknown[] | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const store: CacheStore = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const entry = store[key];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
    return entry.results;
  } catch { return null; }
}

export function saveCache(key: string, results: unknown[]): void {
  ensureConfigDir();
  let store: CacheStore = {};
  try {
    if (fs.existsSync(CACHE_FILE)) {
      store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  const now = Date.now();
  for (const k of Object.keys(store)) {
    if (now - store[k].timestamp > CACHE_TTL_MS) delete store[k];
  }
  store[key] = { timestamp: now, results };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2));
}

function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel(chalk.yellow('UGH. CAVE PERSON LEAVE. BYE.'));
    process.exit(0);
  }
}

function hasSSHKeys(): boolean {
  const sshDir = path.join(os.homedir(), '.ssh');
  if (!fs.existsSync(sshDir)) return false;
  try {
    const files = fs.readdirSync(sshDir);
    return files.some(f => f.startsWith('id_') && !f.endsWith('.pub'));
  } catch { return false; }
}

export async function checkConnectivity(): Promise<boolean> {
  try {
    const res = await fetch('https://api.github.com', { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch { return false; }
}

export async function validateToken(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'project-layman' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { login: string };
    return data.login;
  } catch { return null; }
}

export async function runSetupWizard(): Promise<LaymanConfig> {
  p.intro(chalk.bold.yellow('First-time setup'));

  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  let githubToken: string;
  if (envToken) {
    const useEnv = await p.confirm({
      message: `Found ${chalk.cyan('GITHUB_TOKEN')} in environment. Use it?`,
    });
    handleCancel(useEnv);
    if (useEnv) {
      githubToken = envToken;
    } else {
      const token = await p.text({
        message: 'Enter your GitHub Personal Access Token',
        placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
        validate: (v) => {
          if (!v) return 'Token is required';
          if (!v.startsWith('ghp_') && !v.startsWith('github_pat_')) {
            return 'Token must start with ghp_ or github_pat_';
          }
        },
      });
      handleCancel(token);
      githubToken = token as string;
    }
  } else {
    const token = await p.text({
      message: 'Enter your GitHub Personal Access Token',
      placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
      validate: (v) => {
        if (!v) return 'Token is required';
        if (!v.startsWith('ghp_') && !v.startsWith('github_pat_')) {
          return 'Token must start with ghp_ or github_pat_';
        }
      },
    });
    handleCancel(token);
    githubToken = token as string;
  }

  const s = p.spinner();
  s.start('Validating token with GitHub...');
  const username = await validateToken(githubToken);
  if (!username) {
    s.stop(chalk.red('Token validation failed'));
    p.cancel('UGH. GITHUB TOKEN NO WORK. CHECK AND TRY AGAIN.');
    process.exit(1);
  }
  s.stop(chalk.green(`Authenticated as ${chalk.bold(username)}`));

  const descMode = await p.select({
    message: 'How should repos be described?',
    options: [
      { value: 'script', label: 'Caveman Script', hint: 'offline, no API needed (default)' },
      { value: 'llm', label: 'LLM-powered', hint: 'richer descriptions, needs API key' },
    ],
  });
  handleCancel(descMode);

  let llmProvider: 'anthropic' | 'openai' | 'ollama' | null = null;
  let llmApiKey: string | null = null;
  let llmModel: string | null = null;
  let llmBaseUrl: string | null = null;

  if (descMode === 'llm') {
    const provider = await p.select({
      message: 'Which LLM provider?',
      options: [
        { value: 'anthropic', label: 'Anthropic (Claude)' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'ollama', label: 'Ollama (local)' },
      ],
    });
    handleCancel(provider);
    llmProvider = provider as 'anthropic' | 'openai' | 'ollama';

    if (llmProvider === 'anthropic') {
      const key = await p.text({ message: 'Enter your Anthropic API key', validate: (v) => { if (!v) return 'Required'; } });
      handleCancel(key);
      llmApiKey = key as string;
      llmModel = 'claude-haiku-4-5-20251001';
    } else if (llmProvider === 'openai') {
      const key = await p.text({ message: 'Enter your OpenAI API key', validate: (v) => { if (!v) return 'Required'; } });
      handleCancel(key);
      llmApiKey = key as string;
      llmModel = 'gpt-4o-mini';
    } else if (llmProvider === 'ollama') {
      const url = await p.text({ message: 'Ollama base URL', defaultValue: 'http://localhost:11434' });
      handleCancel(url);
      llmBaseUrl = url as string;
      const model = await p.text({ message: 'Ollama model name', placeholder: 'llama3', validate: (v) => { if (!v) return 'Required'; } });
      handleCancel(model);
      llmModel = model as string;
    }
  }

  const { detectInstalledEditors } = await import('./workspace.js');
  const detected = detectInstalledEditors();
  const editorOptions = detected.map(e => ({ value: e, label: e }));
  editorOptions.push({ value: '__custom', label: 'Other (enter command)' });

  const editorChoice = await p.select({
    message: 'Preferred code editor',
    options: editorOptions,
  });
  handleCancel(editorChoice);

  let editorCommand = editorChoice as string;
  if (editorCommand === '__custom') {
    const cmd = await p.text({ message: 'Enter editor command', validate: (v) => { if (!v) return 'Required'; } });
    handleCancel(cmd);
    editorCommand = cmd as string;
  }

  const wsDir = await p.text({
    message: 'Workspace directory',
    defaultValue: path.join(os.homedir(), 'layman-workspace'),
  });
  handleCancel(wsDir);

  let cloneProtocol: 'https' | 'ssh' = 'https';
  if (hasSSHKeys()) {
    const proto = await p.select({
      message: 'Clone protocol (SSH keys detected)',
      options: [
        { value: 'ssh', label: 'SSH', hint: 'git@github.com:...' },
        { value: 'https', label: 'HTTPS', hint: 'https://github.com/...' },
      ],
    });
    handleCancel(proto);
    cloneProtocol = proto as 'https' | 'ssh';
  }

  const config: LaymanConfig = {
    github_token: githubToken,
    description_mode: descMode as 'script' | 'llm',
    llm: {
      provider: llmProvider,
      api_key: llmApiKey,
      model: llmModel,
      base_url: llmBaseUrl,
    },
    editor: editorCommand,
    editor_command: editorCommand,
    workspace_dir: (wsDir as string).replace(/^~/, os.homedir()),
    default_result_count: 10,
    clone_protocol: cloneProtocol,
  };

  saveConfig(config);

  p.log.info(chalk.dim('Config contains your GitHub token. File permissions set to 600.'));
  p.outro(chalk.bold.green('UGH. LAYMAN READY'));

  return config;
}
