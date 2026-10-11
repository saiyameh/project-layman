import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const input = JSON.parse(process.env.LAYMAN_TEST_INPUT);
os.homedir = () => process.env.LAYMAN_TEST_HOME;
const configDir = path.join(os.homedir(), '.layman');
if (input.saved) {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(input.saved), { mode: 0o600 });
}

globalThis.fetch = async () => {
  if (input.probe === 'fail') return new Response('private provider body', { status: 401 });
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { runLLMSetup } = await import('../../dist/config.js');
try {
  const result = await runLLMSetup(input.config);
  process.stdout.write(JSON.stringify({ result, saved: fs.readFileSync(path.join(configDir, 'config.json'), 'utf8') }));
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
