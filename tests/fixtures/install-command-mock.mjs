import fs from 'node:fs';
import path from 'node:path';

const root = process.env.LAYMAN_INSTALL_TEST_ROOT;
const mode = process.env.LAYMAN_INSTALL_TEST_MODE;
const [tool, ...args] = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ tool, args }) + '\n');
const reject = message => { console.error(message); process.exit(1); };

if (tool === 'node') {
  console.log(mode === 'old-node' ? 'v17.0.0' : 'v24.9.0');
} else if (tool === 'git') {
  if (args[0] === 'clone') {
    if (mode === 'clone-fail') reject('mock clone access denied');
    fs.mkdirSync(args.at(-1), { recursive: true });
  } else if (args[0] === 'rev-parse') {
    if (args.includes('--show-toplevel')) console.log(fs.realpathSync(process.cwd()));
    else {
      if (mode === 'no-upstream') reject('mock missing upstream');
      console.log('origin/main');
    }
  } else if (args[0] === 'remote') {
    console.log(mode === 'other-source' ? 'https://github.com/other/project.git' : 'https://github.com/saiyameh/project-layman.git');
  } else if (args[0] === 'status') {
    if (mode === 'dirty') console.log(' M src/index.ts');
  } else if (args[0] === 'symbolic-ref') {
    if (mode === 'detached') reject('mock detached HEAD');
    console.log('main');
  } else if (args[0] === 'pull') {
    if (mode === 'update-fail') reject('mock non-fast-forward update');
  } else reject(`unexpected git command: ${args.join(' ')}`);
} else if (tool === 'npm') {
  if (args[0] === 'ci' && mode === 'dependency-fail') reject('mock dependency error');
  if (args[0] === 'run' && mode === 'build-fail') reject('mock build error');
  if (args[0] === 'link') {
    if (mode === 'link-fail') reject('mock link permission denied');
    if (mode !== 'missing-path') fs.writeFileSync(path.join(root, 'bin', 'layman'), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  }
} else reject(`installer must not invoke ${tool}`);
