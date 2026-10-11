import { runTrustedCommand } from '../../dist/contribute/checks.js';

const started = Date.now();
const result = runTrustedCommand(process.cwd(), "trap '' TERM; while :; do sleep 1; done", 'fingerprint', 'check', true, 5000);
setTimeout(() => process.emit('SIGINT'), 150);
process.stdout.write(JSON.stringify({ evidence: await result, elapsed: Date.now() - started }));
