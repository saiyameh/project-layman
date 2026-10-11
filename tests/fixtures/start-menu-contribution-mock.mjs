export async function runContributeFlow(_config, path, undo, options) {
  process.stdout.write(`${JSON.stringify({ contribution: { path, undo, options } })}\n`);
}
