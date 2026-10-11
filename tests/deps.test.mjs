import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-deps-'));
after(() => fs.rmSync(repo, { recursive: true, force: true }));

function write(file, content = '') {
  const target = path.join(repo, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('maps source files without executing repository tools', async () => {
  write('apps/web/src/login.ts', "import { token } from './token';\nexport { token };");
  write('apps/web/src/token.ts', 'export const token = true;');
  write('python/main.py', 'from . import helper\n');
  write('python/helper.py', 'value = 1\n');
  write('go.mod', 'module example.test/cave\n');
  write('main.go', 'package main\nimport "example.test/cave/pkg"\n');
  write('pkg/token.go', 'package pkg\n');
  write('rust/lib.rs', 'mod parser;\n');
  write('rust/parser.rs', 'pub fn parse() {}\n');
  write('docs/guide.md', '# docs only');
  write('node_modules/ignored.js', 'throw new Error()');

  const { buildDependencyGraph, findAffectedFiles } = await import('../dist/contribute/deps.js');
  const graph = await buildDependencyGraph({ repoPath: repo, language: ['js', 'python', 'go', 'rust', 'unknown'] });
  const js = graph.find(item => item.language === 'js');
  const python = graph.find(item => item.language === 'python');
  const rust = graph.find(item => item.language === 'rust');
  const go = graph.find(item => item.language === 'go');
  const unknown = graph.find(item => item.language === 'unknown');

  assert.deepEqual(js.edges.get('apps/web/src/login.ts'), ['apps/web/src/token.ts']);
  assert.deepEqual(python.edges.get('python/main.py'), ['python/helper.py']);
  assert.deepEqual(rust.edges.get('rust/lib.rs'), ['rust/parser.rs']);
  assert.deepEqual(go.edges.get('main.go'), ['pkg/token.go']);
  assert.equal(unknown.nodes.includes('node_modules/ignored.js'), false);
  assert.equal(unknown.nodes.includes('docs/guide.md'), false);
  assert.deepEqual(findAffectedFiles([js], ['token']), ['apps/web/src/token.ts', 'apps/web/src/login.ts']);
});

test('returns an empty graph for a documentation-only repository', async () => {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'layman-deps-docs-'));
  try {
    fs.writeFileSync(path.join(docs, 'README.md'), '# Only docs');
    const { buildDependencyGraph } = await import('../dist/contribute/deps.js');
    const [graph] = await buildDependencyGraph({ repoPath: docs, language: ['unknown'] });
    assert.deepEqual(graph.nodes, []);
    assert.deepEqual([...graph.edges], []);
  } finally {
    fs.rmSync(docs, { recursive: true, force: true });
  }
});
