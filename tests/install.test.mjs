import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
const mock = new URL('./fixtures/install-command-mock.mjs', import.meta.url).pathname;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function install(mode, existing = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-install-'));
  const bin = path.join(root, 'bin');
  const destination = path.join(root, 'source with spaces');
  fs.mkdirSync(bin);
  fs.symlinkSync('/bin/cat', path.join(bin, 'cat'));
  if (existing) fs.mkdirSync(destination);
  for (const tool of ['git', 'node', 'npm', 'sudo']) {
    fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(mock)} ${tool} "$@"\n`, { mode: 0o700 });
  }
  try {
    // Pipe input reproduces curl | bash. Commands use only disposable mocks.
    const result = spawnSync('/bin/bash', [], {
      input: script, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: bin, LAYMAN_INSTALL_DIR: destination, LAYMAN_INSTALL_TEST_ROOT: root, LAYMAN_INSTALL_TEST_MODE: mode },
    });
    assert.equal(result.error, undefined, result.error?.message);
    const calls = fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(!calls.some(call => ['sudo', 'layman'].includes(call.tool)));
    return { ...result, calls, destination, output: result.stdout + result.stderr };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('Bash installer is valid and installs from piped input without starting setup', () => {
  assert.equal(spawnSync('/bin/bash', ['-n'], { input: script }).status, 0);
  const result = install('fresh');
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls.filter(call => call.tool === 'npm').map(call => call.args), [['ci', '--include=dev'], ['run', 'build'], ['link']]);
  assert.deepEqual(result.calls.find(call => call.args[0] === 'clone').args, ['clone', '--depth', '1', 'https://github.com/saiyameh/project-layman.git', result.destination]);
  assert.match(result.output, /Layman is ready\. Run: layman/);
  assert.doesNotMatch(result.output, /Run layman now/);
});

test('installer updates the tracked branch with fast-forward only', () => {
  const result = install('update', true);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls.find(call => call.args[0] === 'pull').args, ['pull', '--ff-only']);
  assert.ok(!result.calls.some(call => call.args.includes('master')));
});

for (const [mode, message] of [
  ['dirty', /local changes/], ['other-source', /another source/],
  ['detached', /detached HEAD/], ['no-upstream', /no tracked upstream/],
]) {
  test(`installer preserves existing work on ${mode}`, () => {
    const result = install(mode, true);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, message);
    assert.ok(!result.calls.some(call => call.tool === 'npm' || call.args[0] === 'pull'));
  });
}

test('installer reports failed updates before dependency installation', () => {
  const result = install('update-fail', true);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /mock non-fast-forward update/);
  assert.match(result.output, /Update failed/);
  assert.doesNotMatch(result.output, /Source updated/);
  assert.ok(!result.calls.some(call => call.tool === 'npm'));
});

test('installer rejects unsupported Node versions before cloning', () => {
  const result = install('old-node');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Node.js 18 or later is required/);
  assert.ok(!result.calls.some(call => call.tool === 'git' || call.tool === 'npm'));
});

for (const [mode, message, forbidden] of [
  ['clone-fail', /mock clone access denied/, 'ci'],
  ['dependency-fail', /mock dependency error/, 'run'],
  ['build-fail', /mock build error/, 'link'],
]) {
  test(`installer stops after ${mode} and retains the diagnostic`, () => {
    const result = install(mode);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, message);
    assert.ok(!result.calls.some(call => call.tool === 'npm' && call.args[0] === forbidden));
  });
}

for (const mode of ['link-fail', 'missing-path']) {
  test(`installer provides a direct command on ${mode} without sudo`, () => {
    const result = install(mode);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Run directly: node .*source\\ with\\ spaces\/dist\/index.js/);
    assert.doesNotMatch(result.output, /Layman is ready/);
  });
}

test('installer and CLI use the same detailed caveman banner', async () => {
  const { printBanner } = await import('../dist/ui/display.js');
  const original = console.log;
  let output;
  console.log = value => { output = String(value); };
  try { printBanner(); } finally { console.log = original; }
  const artwork = script.split("cat <<'BANNER'\n")[1].split('\nBANNER')[0];
  assert.ok(output.includes(artwork));
  assert.match(script, /PROJECT LAYMAN UGH\./);
});
