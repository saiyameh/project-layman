import assert from 'node:assert/strict';
import test from 'node:test';

test('script descriptions keep commands, spacing, and negations', async () => {
  const { ScriptDescriber } = await import('../dist/describers/script-describer.js');
  const description = 'Run --path "a  b". Do not delete files.';
  const repo = { description };

  assert.equal(await new ScriptDescriber().describe(repo), description);
  assert.equal(await new ScriptDescriber().describe({ description: '   ' }), 'No description provided.');
});

test('result tables retain the end of long descriptions', async () => {
  const { printRepoTable } = await import('../dist/ui/display.js');
  const original = console.log;
  const output = [];
  console.log = value => output.push(String(value));
  try {
    printRepoTable([{ rank: 1, full_name: 'owner/repo', stars: 1, forks: 1, language: null, caveman_description: 'Read the project instructions before making changes. Never delete files.' }]);
    assert.match(output.join('\n'), /Never delete files/);
  } finally { console.log = original; }
});
