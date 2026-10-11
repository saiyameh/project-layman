import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

os.homedir = () => process.env.LAYMAN_TEST_HOME;
Object.defineProperty(process.stdin, 'isTTY', { value: true });

const configDir = path.join(os.homedir(), '.layman');
fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
  github_token: 'not-used', description_mode: 'llm',
  llm: { provider: null, api_key: null, model: null, base_url: null },
  editor: 'code', editor_command: 'code', workspace_dir: '/tmp/work',
  default_result_count: 10, clone_protocol: 'https',
}), { mode: 0o600 });

await import('../../dist/index.js');
